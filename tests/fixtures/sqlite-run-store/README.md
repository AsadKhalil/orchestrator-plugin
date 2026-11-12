# Transactional run-store probe

Use only in an isolated OpenCode 2.2.7 project with `FEATURE_PILOT_PROBE_DB` pointing to a fresh disposable SQLite file. The fixture creates a synthetic run, updates it and checks that a second connection rejects a stale revision. It does not make a model request. The separate Node worker fixture tests competing processes; neither test proves secure path selection, migration from plugin storage or crash recovery.
