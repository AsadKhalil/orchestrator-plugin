# Relay usage by model — design

**Status:** agreed with the owner in the chat on 19 Nov 2026. Not built yet.

## Intent

The owner wants to see, in Relay's panel and in OpenCode's terminal app, what the messages Relay placed used and cost, per model: the model, the effort, the number of requests, the tokens of each kind (in, out, cache read, cache write), the price of each kind, and the cost worked out from tokens and prices.

## The owner's decisions

- Every request of every message Relay places counts: `/relay` messages and messages in a chat with the switch on, not only the last 20 records (owner: "i want all request to count when relay is on or messages sent through /relay").
- In the terminal app: a `/relay-stats` command that opens the table in a dialog.
- Prices for models OpenCode lists no price for (Claude through a subscription login), and the intelligence index, come from Artificial Analysis's API, with a key from the owner. They chose it over OpenRouter's public list.

## Approaches weighed

- Totals: a running total per model and effort (chosen), or adding up the 20 records Relay keeps (older messages would drop out).
- Price source: Artificial Analysis's API (chosen: a free key; its free model list has the input, output, cache-read and cache-write prices and the indexes; 100 requests a day; its data must be credited where it is shown), OpenRouter's public list (no key, fetched daily already, with the 1-hour cache-write price and price steps), or models.dev (OpenCode's own catalog, no index, a second download).
- Terminal: a `/relay-stats` dialog (chosen), or a section in the chat's sidebar (Relay's first terminal UI component; more to keep working).

## Design

1. **Totals.** A store key, `relay/usage`. When the idle hook keeps what a reply took, the same write adds it to the row of its model and effort: messages, requests, tokens in, out, reasoning, cache read and cache write, OpenCode's cost, and the cost by price of each kind (tokens times that reply's price), with the prices and where they came from. Each reply is counted once.
2. **Prices of a reply.** OpenCode's listed price when it has one (what the owner pays). Otherwise Artificial Analysis's, from the copy Relay keeps; the idle hook never goes to the network.
3. **The key.** Saved from the panel and kept in plugin storage under a key of its own. It is sent only to artificialanalysis.ai, in the `x-api-key` header, and never returned to the panel or written in a record or a note. Without a key there are no borrowed prices, and the index stays OpenRouter's, as now.
4. **Artificial Analysis's data.** `GET /api/v2/language/models/free`, every page, at most once a day, stored. Its models are matched the way the index is matched now; the subscription login's `sonnet`, `haiku`, `opus` and `fable` match the newest Anthropic model of that name.
5. **Calls.** `getRelayUsage`, and one call to save or remove the key; `getRelay` says only whether a key is saved.
6. **Panel.** A "Usage by model" section above Recent choices, the key field, and the credit "Prices and index: Artificial Analysis".
7. **Terminal.** Relay's first terminal part, `dist/tui.js` (package export `./tui`): a `/relay-stats` slash command that asks Relay's RPC for the totals and shows them as a plain-text table in a dialog, with the credit.

## Not in scope

A reset of the totals, totals per chat or per day, the model-switch cost check using borrowed prices (it keeps OpenCode's prices), a sidebar section in the terminal, and price steps from Artificial Analysis (it lists one price per model).

## Left to the builder

How the table looks in the panel, how a model with no match shows, and the layout of the dialog's text.
