# MIT / 2024 Pablo - CDK ECS GPU INFERENCE SERVER - MAKEFILE
#
# The single entrypoint used by developers and CI. Every target chains `install`
# so a fresh checkout works with a bare `make <target>`.

.PHONY: install build lint lint-fix test clean all

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

clean:
	@rm -rf node_modules dist cdk.out
	@echo "[OK] clean"

all: install build lint test
	@echo "[OK] all"
