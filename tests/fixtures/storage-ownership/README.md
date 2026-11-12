# Late ownership storage probe

Use only in an isolated OpenCode 2.2.7 project with `smoke/model-one#high` pointed at the loopback mock provider in `../planner-handoff`. After runtime initialization, the fixture creates an unmarked synthetic session and writes its ownership and role records; it also creates an ordinary control. The marked-owned session must be denied edit and model inference while the ordinary session reaches the mock. This tests one host instance, not concurrent processes, storage tampering or paid inference.
