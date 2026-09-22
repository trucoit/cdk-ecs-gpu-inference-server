# MIT / 2024 Pablo - CDK ECS GPU INFERENCE SERVER - SAMPLE MAKEFILE
#
# Deploy and exercise the sample app. It consumes the library from ../../cdk as
# a file: dependency, so `install` builds the library first, then installs here.

.PHONY: install check-docker synth diff deploy destroy bootstrap invoke-queue invoke-api clean

CDK = node_modules/.bin/cdk
# Override to target one stack, e.g. `make deploy STACK=GpuInferenceApiExample`.
STACK ?= --all
# Model + prompt used by the invoke helpers (keep MODEL in sync with lib/common.ts).
MODEL ?= Qwen/Qwen2.5-1.5B-Instruct
PROMPT ?= Hello, who are you?
# Container builder CDK uses for image assets. Set CDK_DOCKER=finch on machines
# where Docker Desktop is restricted (e.g. Amazon-managed). CDK reads this env var.
CDK_DOCKER ?= docker
export CDK_DOCKER

install:
	@$(MAKE) -C ../../cdk build
	@npm install
	@echo "[OK] install"

# The worker image is a CDK asset, so `deploy`/`bootstrap` need a working builder.
check-docker:
	@command -v $(CDK_DOCKER) >/dev/null 2>&1 || { echo "ERROR: container builder '$(CDK_DOCKER)' not found. Install it or set CDK_DOCKER=<builder>."; exit 1; }
	@$(CDK_DOCKER) info >/dev/null 2>&1 || { echo "ERROR: '$(CDK_DOCKER)' is not ready. For finch run 'finch vm start' (first time: 'finch vm init')."; exit 1; }
	@echo "[OK] container builder: $(CDK_DOCKER)"

synth: install
	@$(CDK) synth
	@echo "[OK] synth"

diff: install
	@$(CDK) diff $(STACK)

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
	@MODEL="$(MODEL)" bash scripts/invoke-api.sh "$(PROMPT)"

clean:
	@rm -rf node_modules cdk.out .template-out
	@echo "[OK] clean"
