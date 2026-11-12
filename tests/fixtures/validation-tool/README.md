# Validation shell tool probe

Run this fixture only in a disposable OpenCode 2.2.7 project. It explicitly permits shell access for one synthetic session and invokes the native shell tool with `printf synthetic-ok` and `exit 7`. It captures the returned result shape, performs no model inference, and must not run in a user's active project or session.
