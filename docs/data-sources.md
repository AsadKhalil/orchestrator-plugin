# Data sources

Relay shows each model's price as OpenCode lists it in its own model catalog (the host's `model.list`; OpenCode fills it from models.dev). Relay downloads nothing itself and makes no request for prices. A provider's own `cost` in an `opencode.json` file is part of that catalog too. The panel shows the base price per 1M tokens, input / output, in its model tables and beside each chosen model.

- A price of 0 in and 0 out reads "$0 or not listed": the catalog gives 0 both for a free model and for a model with no listed price, so Relay never calls a model free.
- A model with no price at all reads "price not listed". On 17 Nov 2026 that was every model of OpenCode's `claude-agent` provider.
- The tables' "Cheapest first" order compares the input price, then the output price, as exact decimals; a price not listed sorts last.

The older pipeline's optional OpenRouter price catalog and its Artificial Analysis scores were removed with it on 17 Nov 2026. Stage 3 of the design (an intelligence index in the lists) would add its source here before any code; it is not scheduled.
