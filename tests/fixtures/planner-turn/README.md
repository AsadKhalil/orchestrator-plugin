# Planner turn probe

Use only in an isolated OpenCode 2.2.7 project with `smoke/model-one#high` pointing to the loopback mock provider in `../planner-handoff`. The fixture deliberately bypasses the production request guard and makes one synthetic model request. It checks one successful checkpointed turn, not paid dispatch, read permissions, crash recovery, cross-process locking or budgets.
