# Prompt replay probe

Run only in a disposable OpenCode 2.2.7 project with `../node_modules/feature-pilot` and the synthetic loopback provider from `../wire-request/mock-provider.mjs`, configured as `smoke/model-one#high`. Register this directory as the local plugin. Count loopback requests separately. This fixture calls the native host prompt API directly, bypassing Feature Pilot's write-ahead check and production spending guard, to observe native replay semantics. Never point it at a paid provider.
