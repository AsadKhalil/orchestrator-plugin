# Observed usage probe

Run only in an isolated OpenCode 2.2.7 project with the built package at `../node_modules/feature-pilot` and the synthetic loopback provider from `../wire-request/mock-provider.mjs` configured as `smoke/model-one#high`. It makes a synthetic local inference request, then reads the partial usage RPC. The fixture bypasses production spending guards and must never use a paid provider. It checks one assistant message only; it does not prove billing completeness.
