# Price data sources

## OpenRouter model catalog

The optional “Load OpenRouter prices” action requests `https://openrouter.ai/api/v1/models` without sending an API key, prompt, source code or model selection. The host making the request contacts OpenRouter and reveals its network address. The [OpenRouter model API](https://openrouter.ai/docs/api/api-reference/models/get-models) documents the model list and `pricing` fields. Checked 2026-11-12.

This source is relevant only to an exact OpenRouter route/model ID; it is not a direct-provider price or an authenticated account quote. The panel shows base input/output token rates per million, with a check time and conditional/extra-field flags. Unknown values and router-model prices are unknown, not free. Conditional overrides, additional modalities, provider routing, discounts, BYOK charges, credit purchase fees, taxes and negotiated terms are not resolved. See [OpenRouter pricing](https://openrouter.ai/pricing). No catalog value is accepted as a hard budget bound or automatic model-selection price.

Successful catalog responses are cached on the host. A refresh failure may return a labelled cached snapshot for at most seven days; invalid or oversized responses are rejected. Prices can change between refresh and inference. No shared API key is included. Public-release review of source terms, benchmark licensing and attribution remains open.
