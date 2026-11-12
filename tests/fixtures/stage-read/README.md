# Stage-read probe

This fixture is for a disposable OpenCode 2.2.7 project with the built package installed at `../node_modules/feature-pilot` relative to `index.js` and the local deterministic provider in `../wire-request/mock-provider.mjs`. Configure a synthetic `smoke/model-one#high` provider pointing to that endpoint and register this fixture as the project plugin. It creates a test session, submits a synthetic prompt, waits, reads the stage and checks that a different run ID cannot read it.

The fixture intentionally uses `createOpenCodeHost` directly without the production runtime's fail-closed spending hook; it must only target the loopback test provider. It verifies one successful read, not the complete billing or production workflow contract.
