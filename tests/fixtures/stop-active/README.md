# Active planner interruption probe

Use only in an isolated OpenCode 2.2.7 project with `smoke/model-one#high` pointed to this directory's loopback mock provider. The fixture deliberately bypasses the production spending guard, starts one synthetic planner request, records a stop request and interrupts its owned session. It does not start a shell or verify subprocess cleanup, actual provider billing, stop/dispatch races or cross-process coordination.
