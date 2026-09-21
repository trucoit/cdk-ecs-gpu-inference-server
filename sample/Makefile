# MIT / 2024 Pablo - CDK ECS GPU INFERENCE SERVER - SAMPLE MAKEFILE
#
# Deploy and exercise the sample app. It consumes the library from ../cdk as a
# file: dependency, so `install` builds the library first, then installs here.

.PHONY: install synth diff deploy destroy bootstrap template clean

CDK = node_modules/.bin/cdk
TEMPLATE_DIR = ../templates
# Override to target one stack, e.g. `make deploy STACK=GpuInferenceApiExample`.
STACK ?= --all

install:
	@$(MAKE) -C ../cdk build
	@npm install
	@echo "[OK] install"

synth: install
	@$(CDK) synth
	@echo "[OK] synth"

diff: install
	@$(CDK) diff $(STACK)

# Regenerate the committed example templates under templates/. Uses a dedicated
# output dir so it never collides with a running `deploy`/`synth` on cdk.out.
template: install
	@mkdir -p $(TEMPLATE_DIR)
	@$(CDK) synth GpuInferenceQueueExample --output .template-out 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-queue.yaml
	@$(CDK) synth GpuInferenceApiExample --output .template-out 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-api.yaml
	@echo "[OK] template"

# One-time per account/region before the first deploy.
bootstrap: install
	@$(CDK) bootstrap

deploy: install
	@$(CDK) deploy $(STACK)

destroy: install
	@$(CDK) destroy $(STACK)

clean:
	@rm -rf node_modules cdk.out
	@echo "[OK] clean"
