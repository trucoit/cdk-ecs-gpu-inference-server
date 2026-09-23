"""Generic SQS poller for the queue inference mode.

Ships with the cdk-ecs-gpu-inference-server construct. It is model-agnostic: the
poll -> fetch input -> call model -> write output -> ack/DLQ lifecycle is fixed,
and the model call is configured entirely through environment variables that the
construct sets from typed `worker` props.

Each SQS message references an S3 input object (`{"s3_key": "async-input/..."}`).
The worker reads that object, calls the local model server, and writes the result
to the matching `async-output/` key.

Configuration (all set by the construct):
  QUEUE_URL, S3_BUCKET            - required wiring
  MODEL_ENDPOINT                  - base URL of the model (default http://localhost:8000)
  HEALTH_ENDPOINT                 - health URL to wait on
  MODEL_ID                        - model name; if unset, discovered via /v1/models
  REQUEST_STYLE                   - chat (default) | completions | raw
  INFER_PATH                      - endpoint path (defaults per style)
  INPUT_FIELD                     - field in the input JSON holding the prompt (default "prompt")
  RESPONSE_POINTER                - dotted path into the response (defaults per style)
  INPUT_PREFIX, OUTPUT_PREFIX     - S3 key prefixes (default async-input/, async-output/)
  LOG_LEVEL                       - Python logging level (default INFO)
"""

import json
import logging
import os
import signal
import sys
import time
import urllib.error
import urllib.request

import boto3

# Log to stdout with the event time and level. ECS ships this to CloudWatch.
# Set LOG_LEVEL=DEBUG for more detail without code changes.
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("worker")

# --- Configuration (all set by the construct from typed `worker` props) ---
QUEUE_URL = os.environ["QUEUE_URL"]
S3_BUCKET = os.environ["S3_BUCKET"]
MODEL_ENDPOINT = os.environ.get("MODEL_ENDPOINT", "http://localhost:8000").rstrip("/")
HEALTH_ENDPOINT = os.environ.get("HEALTH_ENDPOINT", f"{MODEL_ENDPOINT}/health")
REQUEST_STYLE = os.environ.get("REQUEST_STYLE", "chat")
INPUT_FIELD = os.environ.get("INPUT_FIELD", "prompt")
INPUT_PREFIX = os.environ.get("INPUT_PREFIX", "async-input/")
OUTPUT_PREFIX = os.environ.get("OUTPUT_PREFIX", "async-output/")

# The infer path and response pointer both default per request style. A caller
# that overrides one (INFER_PATH / RESPONSE_POINTER) keeps the default for the other.
_DEFAULT_PATHS = {"chat": "/v1/chat/completions", "completions": "/v1/completions", "raw": "/"}
_DEFAULT_POINTERS = {"chat": "choices.0.message.content", "completions": "choices.0.text", "raw": ""}
INFER_PATH = os.environ.get("INFER_PATH", _DEFAULT_PATHS.get(REQUEST_STYLE, "/"))
RESPONSE_POINTER = os.environ.get("RESPONSE_POINTER", _DEFAULT_POINTERS.get(REQUEST_STYLE, ""))

# How long to wait for the model to warm up before giving up, how long to hold a
# long-poll open, and how long a single inference may run. Keep the queue's
# visibility timeout at or above REQUEST_TIMEOUT_S, or a slow job can be
# redelivered to another task and run twice.
HEALTH_TIMEOUT_S = 600
POLL_WAIT_S = 20
REQUEST_TIMEOUT_S = 300

sqs = boto3.client("sqs")
s3 = boto3.client("s3")

# Flipped to False by SIGTERM so the poll loop and the warmup wait both exit.
_running = True


def _stop(_signum, _frame):
    # Stop cleanly on SIGTERM so ECS can drain the task. A message being handled
    # when the signal arrives is not deleted, so it returns to the queue once its
    # visibility timeout elapses.
    global _running
    _running = False


signal.signal(signal.SIGTERM, _stop)


# A GET when data is None, otherwise a JSON POST. Raises on any non-2xx status,
# which lets the caller leave the message for redrive.
def _get_json(url, data=None, timeout=REQUEST_TIMEOUT_S):
    headers = {"Content-Type": "application/json"} if data is not None else {}
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def wait_for_model():
    # Poll the health endpoint until it returns 200 or the deadline passes. A
    # cold start pulls the image and loads weights, so this can take minutes.
    deadline = time.time() + HEALTH_TIMEOUT_S
    while _running and time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_ENDPOINT, timeout=5) as resp:
                if resp.status == 200:
                    logger.info("model healthy")
                    return
        except (urllib.error.URLError, OSError):
            pass  # not up yet; keep waiting
        time.sleep(5)
    if not _running:
        sys.exit(0)  # SIGTERM during warmup
    raise RuntimeError(f"model did not become healthy within {HEALTH_TIMEOUT_S}s")


def resolve_model_id():
    # Raw requests carry their own body, so the model name is never used.
    model_id = os.environ.get("MODEL_ID")
    if model_id or REQUEST_STYLE == "raw":
        return model_id
    # Otherwise discover the served model from the OpenAI-compatible endpoint.
    data = _get_json(f"{MODEL_ENDPOINT}/v1/models", timeout=10)
    models = data.get("data") or []
    if not models:
        raise RuntimeError("/v1/models returned no models; set MODEL_ID explicitly")
    return models[0]["id"]


def pointer(obj, path):
    # Walk a dotted path into the response, treating numeric parts as list
    # indices. An empty path returns the response unchanged (raw style).
    if not path:
        return obj
    for part in path.split("."):
        obj = obj[int(part)] if isinstance(obj, list) else obj[part]
    return obj


def build_request(payload, model_id):
    # Shape the model call for the configured style. Raw passes the input JSON
    # through unchanged; chat and completions wrap the prompt field.
    if REQUEST_STYLE == "raw":
        return payload
    prompt = payload[INPUT_FIELD]
    if REQUEST_STYLE == "completions":
        return {"model": model_id, "prompt": prompt}
    return {"model": model_id, "messages": [{"role": "user", "content": prompt}]}


def output_key(input_key):
    # Mirror the input key under the output prefix, e.g.
    # async-input/job-1.json -> async-output/job-1.json.
    rest = input_key[len(INPUT_PREFIX):] if input_key.startswith(INPUT_PREFIX) else input_key
    return f"{OUTPUT_PREFIX}{rest}"


def handle(message, model_id):
    # Read the S3 input the message points at, call the model, and write the
    # result to the matching output key. Any failure raises, so main() leaves
    # the message for redrive rather than deleting it.
    input_key = json.loads(message["Body"])["s3_key"]
    payload = json.loads(s3.get_object(Bucket=S3_BUCKET, Key=input_key)["Body"].read())

    response = _get_json(f"{MODEL_ENDPOINT}{INFER_PATH}", data=build_request(payload, model_id))
    result = pointer(response, RESPONSE_POINTER)

    # Wrap a scalar result so the output is always a JSON object.
    body = result if isinstance(result, (dict, list)) else {"output": result}
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=output_key(input_key),
        Body=json.dumps(body).encode(),
        ContentType="application/json",
    )
    logger.info("processed %s", input_key)


def main():
    # Wait for the sidecar model, resolve its name once, then long-poll SQS.
    wait_for_model()
    model_id = resolve_model_id()
    logger.info("polling for jobs (model=%s, style=%s)", model_id, REQUEST_STYLE)
    while _running:
        resp = sqs.receive_message(QueueUrl=QUEUE_URL, MaxNumberOfMessages=1, WaitTimeSeconds=POLL_WAIT_S)
        for message in resp.get("Messages", []):
            # Delete only after a successful write. On any error, log with the
            # message id and leave it for the queue's redrive policy / DLQ.
            try:
                handle(message, model_id)
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=message["ReceiptHandle"])
            except Exception:  # noqa: BLE001 - leave the message for redrive/DLQ
                msg_id = message.get("MessageId", "unknown")
                logger.exception("error processing message %s", msg_id)


if __name__ == "__main__":
    main()
