# Feature Pilot

Feature Pilot is an **unfinished prototype** of an OpenCode Desktop plugin for planning, implementing and independently reviewing a feature with models selected by the user. It is not ready for production use or publication as a working orchestrator.

The intended workflow uses three roles: a planner clarifies the requirement and writes a plan, a coder implements the approved plan, and a reviewer from another vendor checks the result. The user chooses the models and variants allowed for each role. The design also calls for bounded repair cycles, spending limits and a comparison with subscription costs. See the [design](docs/opencode-feature-pilot-design.md) and [implementation plan](docs/opencode-feature-pilot-plan.md).

## Current state

- The local server entry has loaded in an isolated OpenCode 2.2.7 host. Desktop panel behavior is not yet verified.
- The prototype includes project-scoped model selections, draft records, a partial observed-usage view and manually entered cost scenarios. Host estimates are incomplete and are not provider bills.
- Artificial Analysis data is optional and requires the user's own key. Displayed entries are not verified model/variant matches and are not used for routing. Users must check their own data-use rights.
- **The end-to-end workflow does not run.** Owned model requests are deliberately blocked until spending controls and host safety requirements are verified. Several workflow and storage components are experimental and not connected to the panel.
- OpenCode 2.2.7's plugin context does not provide a verified way to inspect and stop owned background shells. Session interruption alone did not stop a shell in the isolated probe. See [compatibility findings](docs/compatibility.md).
- Some experiments require a locally modified OpenCode checkout; that fork is not included in this repository. The `smoke-fork-*` scripts expect a sibling checkout named `opencode-host-fork` and do not work from this repository alone.

Do not install this prototype in a working OpenCode profile or provide paid credentials. The [Desktop test checklist](docs/desktop-testing.md) describes the isolated test setup and its current limits.

## Development

The package pins OpenCode's plugin, client and schema packages to 2.2.7. Local checks were run with Node.js 25.9.0:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

Passing these checks does not establish Desktop compatibility, billing accuracy or end-to-end safety. The package is private and unpublished; no license has been selected yet.
