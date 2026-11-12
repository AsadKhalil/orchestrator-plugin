# Coder permission probe

Run only in a disposable OpenCode 2.2.7 project with this fixture registered and the built package at `../node_modules/feature-pilot`. It creates synthetic sessions and explicitly grants test-only shell/edit permissions; it executes `touch` and writes a synthetic file inside the disposable project. It checks the deny-only evaluator against actual write, shell and subagent tools and a separate native edit denial. No model inference is performed. It does not activate a production coder profile or establish path/command scope.
