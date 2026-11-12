# Background shell event probe

Register this plugin in a disposable 2.2.7 OpenCode project with the built package at `../node_modules/feature-pilot`. It creates a synthetic session with test-only shell permission, programmatically approves a synthetic plan, records a job intent, runs a fixed short background command through the native shell tool, and records the matching shell exit event. Its model-resolution hook blocks and counts any model requests. Never use a real project or paid provider.

The test uses a synthetic content version and a short command. It does not establish production authorization, background-service readiness, event replay after disconnect, process-tree cleanup, or actual billing.
