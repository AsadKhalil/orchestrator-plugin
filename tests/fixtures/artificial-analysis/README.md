# Artificial Analysis RPC probe

Use only in a disposable OpenCode 2.2.7 project with `ARTIFICIAL_ANALYSIS_API_KEY=synthetic-key`. The fixture temporarily replaces `fetch` with two synthetic pages, calls the typed RPC, restores `fetch`, and reports count/version/unknown-score and whether the key leaked. It makes no real Artificial Analysis or model request. It does not establish live API behavior, source rights or Desktop rendering.
