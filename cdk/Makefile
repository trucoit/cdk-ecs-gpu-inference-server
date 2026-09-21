# MIT / 2024 Pablo - CDK ECS GPU INFERENCE SERVER - MAKEFILE
#
# The single entrypoint used by developers and CI. Every target chains `install`
# so a fresh checkout works with a bare `make <target>`.

.PHONY: install build lint lint-fix test template clean all

CDK = node_modules/.bin/cdk
TEMPLATE_DIR = ../templates

install:
	@npm install
	@echo "[OK] install"

build: install
	@npm run build
	@echo "[OK] build"

lint: install
	@npm run lint
	@echo "[OK] lint"

lint-fix: install
	@npm run lint:fix
	@echo "[OK] lint-fix"

# The single target CI invokes: lint + unit tests (incl. cdk-nag).
test: install lint
	@npm test
	@echo "[OK] test"

# Generate the standalone, parameterized CloudFormation templates (one per mode)
# that people deploy without CDK. Dedicated output dir avoids cdk.out collisions.
template: install
	@mkdir -p $(TEMPLATE_DIR)
	@$(CDK) synth GpuInferenceQueue --output .template-out 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-queue.yaml
	@$(CDK) synth GpuInferenceApi --output .template-out 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-api.yaml
	@echo "[OK] template"

clean:
	@rm -rf node_modules dist cdk.out .template-out
	@echo "[OK] clean"

all: install build lint test
	@echo "[OK] all"
