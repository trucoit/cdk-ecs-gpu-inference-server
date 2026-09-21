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
"""

import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request

import boto3

QUEUE_URL = os.environ["QUEUE_URL"]
S3_BUCKET = os.environ["S3_BUCKET"]
MODEL_ENDPOINT = os.environ.get("MODEL_ENDPOINT", "http://localhost:8000").rstrip("/")
HEALTH_ENDPOINT = os.environ.get("HEALTH_ENDPOINT", f"{MODEL_ENDPOINT}/health")
REQUEST_STYLE = os.environ.get("REQUEST_STYLE", "chat")
INPUT_FIELD = os.environ.get("INPUT_FIELD", "prompt")
INPUT_PREFIX = os.environ.get("INPUT_PREFIX", "async-input/")
OUTPUT_PREFIX = os.environ.get("OUTPUT_PREFIX", "async-output/")

_DEFAULT_PATHS = {"chat": "/v1/chat/completions", "completions": "/v1/completions", "raw": "/"}
_DEFAULT_POINTERS = {"chat": "choices.0.message.content", "completions": "choices.0.text", "raw": ""}
INFER_PATH = os.environ.get("INFER_PATH", _DEFAULT_PATHS.get(REQUEST_STYLE, "/"))
RESPONSE_POINTER = os.environ.get("RESPONSE_POINTER", _DEFAULT_POINTERS.get(REQUEST_STYLE, ""))

HEALTH_TIMEOUT_S = 600
POLL_WAIT_S = 20
REQUEST_TIMEOUT_S = 300

sqs = boto3.client("sqs")
s3 = boto3.client("s3")

_running = True


def _stop(_signum, _frame):
    # Stop cleanly on SIGTERM so ECS can drain the task; in-flight messages
    # return to the queue once their visibility timeout elapses.
    global _running
    _running = False


signal.signal(signal.SIGTERM, _stop)


def _get_json(url, data=None, timeout=REQUEST_TIMEOUT_S):
    headers = {"Content-Type": "application/json"} if data is not None else {}
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def wait_for_model():
    deadline = time.time() + HEALTH_TIMEOUT_S
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_ENDPOINT, timeout=5) as resp:
                if resp.status == 200:
                    print("model healthy", flush=True)
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(5)
    raise RuntimeError(f"model did not become healthy within {HEALTH_TIMEOUT_S}s")


def resolve_model_id():
    model_id = os.environ.get("MODEL_ID")
    if model_id:
        return model_id
    # Discover the served model from the OpenAI-compatible /v1/models endpoint.
    data = _get_json(f"{MODEL_ENDPOINT}/v1/models", timeout=10)
    return data["data"][0]["id"]


def pointer(obj, path):
    if not path:
        return obj
    for part in path.split("."):
        obj = obj[int(part)] if isinstance(obj, list) else obj[part]
    return obj


def build_request(payload, model_id):
    if REQUEST_STYLE == "raw":
        return payload
    prompt = payload[INPUT_FIELD]
    if REQUEST_STYLE == "completions":
        return {"model": model_id, "prompt": prompt}
    return {"model": model_id, "messages": [{"role": "user", "content": prompt}]}


def output_key(input_key):
    rest = input_key[len(INPUT_PREFIX):] if input_key.startswith(INPUT_PREFIX) else input_key
    return f"{OUTPUT_PREFIX}{rest}"


def handle(message, model_id):
    input_key = json.loads(message["Body"])["s3_key"]
    payload = json.loads(s3.get_object(Bucket=S3_BUCKET, Key=input_key)["Body"].read())

    response = _get_json(f"{MODEL_ENDPOINT}{INFER_PATH}", data=build_request(payload, model_id))
    result = pointer(response, RESPONSE_POINTER)

    body = result if isinstance(result, (dict, list)) else {"output": result}
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=output_key(input_key),
        Body=json.dumps(body).encode(),
        ContentType="application/json",
    )
    print(f"processed {input_key}", flush=True)


def main():
    wait_for_model()
    model_id = resolve_model_id()
    print(f"polling for jobs (model={model_id}, style={REQUEST_STYLE})", flush=True)
    while _running:
        resp = sqs.receive_message(QueueUrl=QUEUE_URL, MaxNumberOfMessages=1, WaitTimeSeconds=POLL_WAIT_S)
        for message in resp.get("Messages", []):
            try:
                handle(message, model_id)
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=message["ReceiptHandle"])
            except Exception as err:  # noqa: BLE001 - leave the message for redrive/DLQ
                print(f"error processing message: {err}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
