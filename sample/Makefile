# MIT / 2024 Pablo - CDK ECS GPU INFERENCE SERVER - SAMPLE MAKEFILE
#
# Deploy and exercise the sample app. It consumes the library from ../cdk as a
# file: dependency, so `install` builds the library first, then installs here.

.PHONY: install check-docker synth diff deploy destroy bootstrap template invoke-queue invoke-api clean

CDK = node_modules/.bin/cdk
TEMPLATE_DIR = ../templates
# Override to target one stack, e.g. `make deploy STACK=GpuInferenceApiExample`.
STACK ?= --all
# Model + prompt used by the invoke helpers (keep MODEL in sync with lib/common.ts).
MODEL ?= Qwen/Qwen2.5-1.5B-Instruct
PROMPT ?= Hello, who are you?

install:
	@$(MAKE) -C ../cdk build
	@npm install
	@echo "[OK] install"

# The worker image is a CDK asset, so `deploy`/`bootstrap` need Docker to build it.
check-docker:
	@command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker is required to build the worker image. Install Docker and retry."; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "ERROR: Docker is installed but not running. Start Docker and retry."; exit 1; }
	@echo "[OK] docker"

synth: install
	@$(CDK) synth
	@echo "[OK] synth"

diff: install
	@$(CDK) diff $(STACK)

# Regenerate the committed example templates under templates/. Uses a dedicated
# output dir so it never collides with a running `deploy`/`synth` on cdk.out.
# No Docker needed: synth stages the worker asset context and hashes it.
template: install
	@mkdir -p $(TEMPLATE_DIR)
	@$(CDK) synth GpuInferenceQueueExample --output .template-out 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-queue.yaml
	@$(CDK) synth GpuInferenceApiExample --output .template-out 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-api.yaml
	@echo "[OK] template"

# One-time per account/region before the first deploy.
bootstrap: check-docker install
	@$(CDK) bootstrap

deploy: check-docker install
	@$(CDK) deploy $(STACK)

destroy: install
	@$(CDK) destroy $(STACK)

# Submit a job to the queue stack and wait for the result in S3.
invoke-queue:
	@bash scripts/submit-job.sh "$(PROMPT)"

# Call the API stack's ALB endpoint (internet-facing in this sample).
invoke-api:
	@API_URL=$$(aws cloudformation describe-stacks --stack-name GpuInferenceApiExample \
	  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text); \
	echo "POST $$API_URL/v1/chat/completions"; \
	curl -sS "$$API_URL/v1/chat/completions" -H 'Content-Type: application/json' \
	  -d "$$(python3 -c "import json,sys; print(json.dumps({'model': sys.argv[1], 'messages': [{'role':'user','content': sys.argv[2]}]}))" "$(MODEL)" "$(PROMPT)")"; \
	echo

clean:
	@rm -rf node_modules cdk.out .template-out
	@echo "[OK] clean"
