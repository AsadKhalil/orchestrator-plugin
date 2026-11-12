# Planner tool-turn probe

Use only in an isolated OpenCode 2.2.7 project with `smoke/model-one#high` pointing to this directory's loopback mock provider and a synthetic `planner-readable.txt`. The fixture deliberately removes the deny-all session rules and bypasses the production request guard. It reads the synthetic file and issues two local mock-model requests; never use a paid endpoint. It checks one read-only tool turn and the final structured reply, not billing, arbitrary tool paths, cross-instance safety or a production workflow.
