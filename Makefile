.PHONY: install dev test deploy

install:
	cd worker && npm ci

# Worker + frontend osoitteessa http://localhost:8787
dev: install
	cd worker && npm run dev

test: install
	cd worker && npm run typecheck && npm test

deploy: install
	cd worker && npm run deploy
