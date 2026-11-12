# Local run export probe

Use only in a disposable Git project with an initialized baseline and an isolated OpenCode 2.2.7 server. The fixture creates a synthetic draft and retrieves a revision-checked JSON export preview through the typed RPC. It makes no model request and writes no export file. The preview contains user-authored artifacts and must be reviewed before sharing; it does not include an actual diff or complete costs.
