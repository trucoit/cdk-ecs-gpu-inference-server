# MIT / 2024 Pablo - CDK ECS GPU INFERENCE SERVER - MAKEFILE
#
# The single entrypoint used by developers and CI. Every target chains `install`
# so a fresh checkout works with a bare `make <target>`.

.PHONY: install build lint lint-fix test synth template clean all

# Where the committed, generated CloudFormation templates are written (repo root).
TEMPLATE_DIR = ../templates
CDK = node_modules/.bin/cdk

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

synth: install
	@npm run synth
	@echo "[OK] synth"

# Regenerate the committed example templates from the CDK app. CI runs this and
# commits any change back, so the checked-in YAML always matches the source.
template: install
	@mkdir -p $(TEMPLATE_DIR)
	@$(CDK) synth GpuInferenceQueueExample 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-queue-example.yaml
	@$(CDK) synth GpuInferenceApiExample 2>/dev/null > $(TEMPLATE_DIR)/gpu-inference-api-example.yaml
	@echo "[OK] template"

clean:
	@rm -rf node_modules dist cdk.out
	@echo "[OK] clean"

all: install build lint test
	@echo "[OK] all"
