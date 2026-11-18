# Data sources

Relay shows each model's price as OpenCode lists it in its own model catalog (the host's `model.list`; OpenCode fills it from models.dev). Relay downloads nothing itself and makes no request for prices. A provider's own `cost` in an `opencode.json` file is part of that catalog too. The panel shows the base price per 1M tokens, input / output, in its model tables and beside each chosen model.

- A price of 0 in and 0 out reads "$0 or not listed": the catalog gives 0 both for a free model and for a model with no listed price, so Relay never calls a model free.
- A model with no price at all reads "price not listed". On 17 Nov 2026 that was every model of OpenCode's `claude-agent` provider.
- The tables' "Cheapest first" order compares the input price, then the output price, as exact decimals; a price not listed sorts last.

## Intelligence index

Since 18 Nov 2026 the model tables show the **Artificial Analysis Intelligence Index** of each model Relay can match, taken from OpenRouter's public model list (`https://openrouter.ai/api/v1/models`, the `benchmarks.artificial_analysis.intelligence_index` field).

- **What leaves the machine.** One plain GET of that public list, with no key, no cookie and nothing about the person or their models. It is fetched when the panel asks for the index and at most once a day: the result is kept in Relay's plugin storage, and a failed fetch falls back to the stored copy. A reply with no index at all is treated as a failure, so it cannot replace a good copy.
- **How models are matched.** OpenCode's model records share no id with OpenRouter's list. Relay compares the model's id, then its name, with each listed model's id. Both sides are put in one form first: no vendor, lower case, dashes for dots, colons and spaces, and no variant suffix such as ":batch", ":free" or OpenCode's "-free". After that it tries the one listed model whose id ends in the model's id or name, if exactly one does. A form that two different listed models share matches nothing, and the table shows "—". The cell's tooltip names the OpenRouter model each number came from.
- **What the number means.** It is for the model in general, as Artificial Analysis tested it, not for the effort you set. OpenRouter states no index version.
- **Coverage.** Measured on 18 Nov 2026 against models.dev's lists, it matched 15 of 27 Ollama Cloud models and 8 of 18 Anthropic models. OpenCode's Claude Agent models Sonnet 5.5, Haiku 5.5 and Opus 5.5 matched by name. Joining on models.dev's `canonical_model_id` would add a few more (17 of 27 Ollama Cloud models), but it means a 6.7 MB download, so it is not done.
- **Terms.** Artificial Analysis limits reuse of its data. Relay copies none of it into this repository or the package: each person's own Relay reads OpenRouter's public list at run time, as OpenRouter's own site shows it. The owner asked for this on 18 Nov 2026. This is a reading, not legal advice.

The older pipeline's optional OpenRouter price catalog and its separate Artificial Analysis panel, which needed a key, were removed on 17 Nov 2026.
