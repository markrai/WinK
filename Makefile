.PHONY: test test-provenance test-branding live live-provenance install uninstall package apply-config standalone

test:
	node tests/state-machine.test.mjs

test-provenance:
	node tests/provenance.test.mjs

test-branding:
	node tests/branding.test.mjs

live:
	node tests/live-matrix.mjs

live-provenance:
	node tests/live-provenance.mjs

install:
	./scripts/install.sh

apply-config:
	./scripts/apply-plasma-config.sh

uninstall:
	./scripts/uninstall.sh

standalone:
	python3 scripts/build-standalone.py

package:
	cd wink && zip -r ../wink.kwinscript metadata.json contents
	@echo "Created wink.kwinscript"
