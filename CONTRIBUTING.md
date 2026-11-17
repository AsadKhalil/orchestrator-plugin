# Contributing to Relay

Thanks for helping. Relay is an OpenCode plugin (package `relay-opencode`). `/relay <message>` asks a small decision model whether a message is plan, execute or review work, picks the model you chose for that kind of work, and sends the message there. The [README](README.md) says what it does and how to install it.

## Set up

1. Install Node 24 (what CI uses) and git.
2. Clone the repo and run `npm ci`.
3. Run the four checks. All four must pass before you open a pull request. CI runs them on Linux and Windows, and also runs the smoke below on Linux, macOS and Windows:

   ```
   npm run typecheck
   npm test
   npm run build
   node scripts/check-package.mjs
   ```

## Where things are

- `src/` is the plugin. `index.ts` connects everything to OpenCode. `relay-command.ts` is `/relay`, `review-helper.ts` gives helpers that check work a Review model, `router.ts` holds the routing rules (pure functions, no OpenCode calls), `decider.ts` builds the question for the decision model, `relay-store.ts` keeps the settings and recent decisions, `relay-view.ts` holds the words the panel and the pill show, `rpc.ts` and `contract.ts` are the calls the panel makes, and `gui.tsx` is the side panel and the pill.
- `tests/` holds `node:test` tests, run through `tsx`. `tests/relay-fakes.ts` is a fake OpenCode host for the Relay tests.
- `scripts/` holds the smoke test against a real OpenCode binary (`smoke-host-model.mjs`), the package check, and the decider's example run.
- `docs/` holds what was seen on real OpenCode hosts (`compatibility.md`), a dated log of changes (`implementation-progress.md`), and the design and plans (`superpowers/`).

## How to make a change

- **Write the test first.** Watch it fail, then make it pass. For a new guard, break it once and check that its test turns red.
- **Keep the fakes honest.** A fake host in a test should behave like the real one. If you find a difference, fix the fake and say so.
- **Never use real keys or your own OpenCode profile in tests.** The smoke (`npm run smoke:host:model`) installs the packed plugin into an isolated OpenCode with scratch folders, a throwaway password and a mock model. It needs `npm run build` first, and `RELAY_SMOKE_CLI` set to an OpenCode 2.3.0 binary. To get one without installing OpenCode, run `npm install --prefix <folder> --ignore-scripts @opencode/cli-<os>-<arch>@2.3.0` (for example `cli-linux-x64`, `cli-darwin-arm64` or `cli-windows-x64`); the binary is in `<folder>/node_modules/@opencode/cli-<os>-<arch>/bin/`.
- **Don't call something verified when it only ran against fakes.** If you try a change on a real OpenCode, add what you saw to `docs/compatibility.md` (platform, OpenCode version, and what you did not test), and one dated line to `docs/implementation-progress.md`.
- **Rules the code relies on:**
  - Every RPC method in `src/contract.ts` declares its errors. A test checks this.
  - Money is a USD string backed by `bigint` (`src/costs.ts`), never a float.
  - The panel imports `router.ts`, `decider.ts`, `relay-store.ts`, `relay-view.ts` and `costs.ts`, so they, and what they import, must not import anything from `node:`.
  - The package name, the plugin id and the RPC id are all `relay-opencode`, and a test keeps them equal. OpenCode keeps each plugin's saved settings under its id, so a new id loses everyone's settings.
  - Mark a deliberate simplification with a `// shortcut:` comment that says where it stops working.
  - Keep each file's existing line endings.
- `AGENTS.md` lists the same rules for coding agents, and more detail on each.

## Pull requests

- One topic per pull request, with a short description of what changed and how you tested it: fakes, smokes, or a real OpenCode.
- The four checks pass and CI is green.
- By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).

## Releasing (maintainers)

1. Raise `version` in `package.json` and add a dated line to `docs/implementation-progress.md`.
2. Run `npm login`, then `npm publish`. `prepublishOnly` runs the four checks first and stops the release if one fails.
3. People can then install with one line: `"plugins": ["relay-opencode"]` in their global `opencode.json`. OpenCode installs the package from npm by itself.

## Reporting a problem

Open a GitHub issue with your OpenCode version (`opencode --version`), your operating system, what you typed, what you expected and what happened. Leave API keys and anything private out of logs and screenshots.
