# Session metadata ownership probe

Run only in an isolated OpenCode 2.2.7 project using `smoke/model-one#high` with the loopback mock provider in `../planner-handoff`. The fixture starts the actual Feature Pilot runtime, then creates a synthetic session carrying planner ownership metadata after the runtime's initial scan and an ordinary control session. It checks the permission hook and sends one prompt to each; only the ordinary session should reach the mock. This does not prove safety against metadata removal or forgery, multiple host processes, storage races or paid providers.
