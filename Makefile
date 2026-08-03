# Skills Coach — developer entrypoints.
#
# `make help` lists every target. CI does not call these (it drives docker directly, because the
# runner talks to a host Docker socket and cannot bind-mount) — but `make check` runs the same
# checks the DoD gate runs, so a green `make check` should mean a green pipeline.

COMPOSE := docker compose -f infra/docker/compose.yml -p skills-coach
PACK    ?= packs/demo-conversation-nl

.DEFAULT_GOAL := help
.PHONY: help install dev up down logs ps seed import import-errorlog validate test test-unit lint format typecheck check clean

help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- dependencies -------------------------------------------------------------

install: ## Install api + web dependencies
	cd api && npm install
	cd web && npm install

## --- running ------------------------------------------------------------------

up: ## Start mongodb + api + web (detached)
	$(COMPOSE) up -d --build --remove-orphans
	@echo "web  http://localhost:$${WEB_PORT:-8011}"
	@echo "api  http://localhost:$${API_PORT:-8010}/health"

down: ## Stop the stack (volumes are kept)
	$(COMPOSE) down --remove-orphans

ps: ## Show stack status
	$(COMPOSE) ps

logs: ## Tail all service logs
	$(COMPOSE) logs -f --tail=100

dev: ## Run api + web with hot reload against the compose MongoDB
	$(COMPOSE) up -d mongo
	@echo "Starting api (:8010) and web (:8011) — Ctrl-C stops both."
	@trap 'kill 0' INT TERM; \
	  (cd api && npm run dev) & \
	  (cd web && npm run dev) & \
	  wait

## --- content ------------------------------------------------------------------

seed: ## Publish the bundled demo pack into the running stack
	cd api && npm run import:pack -- --source ../$(PACK)

import: ## Import a pack from a local directory: make import PACK=/path/to/pack
	cd api && npm run import:pack -- --source $(PACK)

import-errorlog: ## Backfill a learner's error log: make import-errorlog SOURCE=... LEARNER=...
	cd api && npm run import:errorlog -- --source $(SOURCE) --learner $(LEARNER)

validate: ## Parse and lint every pack manifest in the tree
	cd api && npm run validate:manifests

## --- checks -------------------------------------------------------------------

typecheck: ## tsc --noEmit for both packages
	cd api && npm run typecheck
	cd web && npm run typecheck

lint: ## eslint + prettier check for both packages
	cd api && npm run lint
	cd web && npm run lint

format: ## Rewrite files with prettier
	cd api && npm run format
	cd web && npm run format

test-unit: ## Unit tests only (no MongoDB needed)
	cd api && npm run test:unit

test: ## All tests (integration self-skips when MongoDB is unreachable)
	cd api && npm test
	cd web && npm test

check: typecheck lint test validate ## Everything CI checks

clean: ## Remove build output and the MongoDB volume
	$(COMPOSE) down -v --remove-orphans
	rm -rf api/dist api/node_modules web/.next web/node_modules
