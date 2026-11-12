# Clarification storage probe

In a disposable OpenCode 2.2.7 project, register this fixture with the built package installed at `../node_modules/feature-pilot`. On successive server starts it creates a synthetic pending question, restores and answers it, then restores the answered run. It makes no model request and must use an isolated plugin store.
