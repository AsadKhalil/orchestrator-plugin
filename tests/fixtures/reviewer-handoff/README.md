# Reviewer handoff probe

Run only in a disposable OpenCode 2.2.7 project with `smoke/model-one#high` pointed at this directory's loopback mock provider. The fixture deliberately bypasses the production inference guard, uses synthetic plan and validation evidence, and sends one synthetic local request. It tests the owned reviewer response handoff, not real code review, verified diff identity, independent vendor identity, permissions, or billing.
