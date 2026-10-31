EPISODE ?= episodes/001-pdf-ca-signature
PY := uv run --project pipeline

.PHONY: setup audio render cover all clean

setup:
	uv sync --project pipeline
	cd pipeline && pnpm install

audio:
	$(PY) python pipeline/tts.py $(EPISODE)

render:
	node pipeline/render.mjs $(EPISODE)

cover:
	node pipeline/cover.mjs $(EPISODE)

all: audio render cover

clean:
	rm -rf $(EPISODE)/render
