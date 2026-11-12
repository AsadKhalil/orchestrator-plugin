# Stop request persistence probe

Use only in a disposable OpenCode 2.2.7 project with isolated state. Initialize the host once to create a synthetic stopped run, stop it and restart with the same state. The second initialization must restore the stop request and reject a further transition. This fixture makes no model or process calls and does not test interruption or cleanup.
