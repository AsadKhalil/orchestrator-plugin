# Planner recovery probe

Use only in a disposable OpenCode 2.2.7 project with `smoke/model-one#high` pointed at the synthetic loopback mock provider in `../planner-handoff`. It bypasses the production spending guard, simulates a lost wait after one local prompt, waits for that existing synthetic session and reconciles using fresh adapter objects. It does not restart the host or verify paid dispatch, billing, process crashes or cross-process safety.
