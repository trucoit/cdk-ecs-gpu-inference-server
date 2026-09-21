#!/usr/bin/env bash
# Submit one job to the queue-mode sample and wait for the result.
#
# Usage: scripts/submit-job.sh "your prompt here"
# Env:   STACK_NAME (default GpuInferenceQueueExample)
set -euo pipefail

PROMPT="${1:-Hello, who are you?}"
STACK="${STACK_NAME:-GpuInferenceQueueExample}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(output DataBucketName)"
QUEUE="$(output JobQueueUrl)"
if [ -z "$BUCKET" ] || [ -z "$QUEUE" ]; then
  echo "ERROR: could not read stack outputs from $STACK (is it deployed?)" >&2
  exit 1
fi

JOB_ID="job-$(date +%s)-$RANDOM"
IN_KEY="async-input/${JOB_ID}.json"
OUT_KEY="async-output/${JOB_ID}.json"
TMP="$(mktemp -d)"

python3 -c "import json,sys; open(sys.argv[1],'w').write(json.dumps({'prompt': sys.argv[2]}))" "$TMP/in.json" "$PROMPT"
aws s3 cp "$TMP/in.json" "s3://${BUCKET}/${IN_KEY}" --content-type application/json >/dev/null
aws sqs send-message --queue-url "$QUEUE" \
  --message-body "$(python3 -c "import json,sys; print(json.dumps({'s3_key': sys.argv[1]}))" "$IN_KEY")" >/dev/null

echo "submitted ${IN_KEY}; the service scales 0->1 and the first run is slow (image pull + model load)."
echo "waiting for s3://${BUCKET}/${OUT_KEY} ..."
for _ in $(seq 1 160); do
  if aws s3 cp "s3://${BUCKET}/${OUT_KEY}" "$TMP/out.json" >/dev/null 2>&1; then
    echo "=== result ==="
    cat "$TMP/out.json"
    echo
    exit 0
  fi
  sleep 15
done

echo "timed out waiting for ${OUT_KEY}" >&2
exit 1
