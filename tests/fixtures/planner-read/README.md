# Planner read permission probe

Use only in a disposable OpenCode 2.2.7 project containing `planner-readable.txt` with the synthetic text `synthetic-readable`. The fixture creates a session with no extra permission rules, applies the deny-only planner hook, reads the synthetic file and attempts synthetic write and shell actions. It does not issue a model request. It does not prove MCP, browser, subagent, nested tools, project-policy precedence, cross-instance safety or production role enforcement.
