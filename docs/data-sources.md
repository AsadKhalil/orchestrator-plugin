# Price data sources

## OpenRouter model catalog

The optional “Load OpenRouter prices” action requests `https://openrouter.ai/api/v1/models` without sending an API key, prompt, source code or model selection. The host making the request contacts OpenRouter and reveals its network address. The [OpenRouter model API](https://openrouter.ai/docs/api/api-reference/models/get-models) documents the model list and `pricing` fields. Checked 2026-11-12.

This source is relevant only to an exact OpenRouter route/model ID; it is not a direct-provider price or an authenticated account quote. The panel shows base input/output token rates per million, with a check time and conditional/extra-field flags. Unknown values and router-model prices are unknown, not free. Conditional overrides, additional modalities, provider routing, discounts, BYOK charges, credit purchase fees, taxes and negotiated terms are not resolved. See [OpenRouter pricing](https://openrouter.ai/pricing). No catalog value is accepted as a hard budget bound or automatic model-selection price.

Successful catalog responses are cached on the host. A refresh failure may return a labelled cached snapshot for at most seven days; invalid or oversized responses are rejected. Prices can change between refresh and inference. No shared API key is included. Public-release review of source terms, benchmark licensing and attribution remains open.

## Artificial Analysis (benchmark scores)

- A user-supplied key for the free Artificial Analysis (AA) endpoint is treated as **internal use only**: it may inform that user's own local decisions, subject to the [AA terms](https://artificialanalysiscdn.com/legal/ProDataPlatformTerms.pdf) (sections 2.4–2.5 restrict redistribution and public model-selection products). The [AA v2 documentation](https://artificialanalysis.ai/data-api/docs) describes the endpoint and index-version metadata. The project owner must confirm this reading before any release; it is not legal advice.
- Public AA-backed selection returns `benchmark_source_not_authorized` until AA grants written permission covering the actual displayed and exported data. Neither a bring-your-own key nor a third-party feed is assumed to grant it.
- No AA dataset, export or cached response ships in the package or the repository. Tests and demos use synthetic fixtures only; `node scripts/check-package.mjs` fails a package containing benchmark data paths. No shared AA key is included, and user keys are never stored in GUI storage.
- Scores are used with their index version; a missing version is shown, and different versions are never blended or compared as a time series. AA Coding/Agentic Index fields are discontinued and are not used for ranking.

## Official provider price pages

Direct-provider rates (input, output, cache read/write, long-context tiers, batch, regional and time-of-day rates) are checked by a person against the official pages below, then entered with the source URL and check date. The OpenRouter catalog is a community cross-check, never an official price.

- OpenAI: <https://developers.openai.com/api/docs/pricing>
- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>
- Gemini: <https://aistudio.google.com/docs/pricing>
- DeepSeek: <https://api-docs.deepseek.com/quick_start/pricing/>

`npm run check:prices -- --rates <rates.json> [--catalog <openrouter-models.json>]` prints a read-only delta (changed, missing, unchanged) between proposed rates and the OpenRouter catalog. It never writes a file or overwrites a rate, and its output is a prompt to re-check the official page, not a substitute. The design brief lists these four pages as references checked 2026-11-11; this repository stores no official rate values and claims no current official price.

## Subscription credits and plan facts

Plan fees, included API credits, eligibility, claim state, expiry and remaining balance are **dated, user-entered data**, each with a source URL, a check date and a verified/unverified balance flag. Current documentation: [OpenAI ChatGPT API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits), [Anthropic monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans). These terms change and carry exclusions; they are inputs to a comparison, not constants.

The plugin does not scrape or read private billing pages, does not reuse a subscription login as API credit, and does not turn subscription allowance use into invented dollars: subscription and local attempts are counted separately and shown as unknown allowance use. A credit offsets only its own provider, route and period, and an unverified balance is labelled as such.
