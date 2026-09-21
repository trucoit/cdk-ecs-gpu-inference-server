#!/usr/bin/env bash
# Call the API-mode sample's ALB endpoint with one chat-completions request.
#
# Usage: scripts/invoke-api.sh "your prompt here"
# Env:   STACK_NAME (default GpuInferenceSample), MODEL (default Qwen/Qwen2.5-1.5B-Instruct)
set -euo pipefail

PROMPT="${1:-Hello, who are you?}"
STACK="${STACK_NAME:-GpuInferenceSample}"
MODEL="${MODEL:-Qwen/Qwen2.5-1.5B-Instruct}"

API_URL="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)"
if [ -z "$API_URL" ] || [ "$API_URL" = "None" ]; then
  echo "ERROR: could not read ApiUrl from $STACK (is it deployed?)" >&2
  exit 1
fi

BODY="$(MODEL="$MODEL" PROMPT="$PROMPT" python3 -c '
import json, os
print(json.dumps({
    "model": os.environ["MODEL"],
    "messages": [{"role": "user", "content": os.environ["PROMPT"]}],
}))')"

echo "POST ${API_URL}/v1/chat/completions"
RESPONSE="$(curl -sS "${API_URL}/v1/chat/completions" -H 'Content-Type: application/json' -d "$BODY")"

# Pretty-print with jq when it is installed; fall back to the raw body otherwise.
if command -v jq >/dev/null 2>&1; then
  echo "$RESPONSE" | jq .
else
  echo "$RESPONSE"
fi
