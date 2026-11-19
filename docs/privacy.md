# What leaves your machine

To choose, Relay sends the decider's provider your message text (at most 4,000 characters), the names and sizes of attached files (not their contents), how many pictures are attached, whether the chat's agent can change files, and your "use it for" lines. It never sends file contents, pictures, earlier messages, model names or prices. When a model starts a helper, the helper's task text is sent the same way; that text is written by the model and may quote code or chat content you do not see.

To weigh a move and to show what a reply took, Relay reads the chat's token counts, costs and times, the model that answered, and that model's listed prices from OpenCode on your machine. It keeps them with its last 20 records in OpenCode's plugin storage and sends them nowhere. It never stores the text of your messages.

To show the intelligence index, Relay downloads OpenRouter's public model list, at most once a day. It sends no key and nothing about you or your models. [Data sources](data-sources.md) has the details.

OpenCode makes every model request, with your OpenCode login. Relay never sees your API keys.
