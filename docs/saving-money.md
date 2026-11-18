# When Relay saves money

No saving has been measured yet. This page is arithmetic on list prices, plus what one check on an isolated OpenCode with mock models showed. The working is in [the cost research](research/2026-11-17-relay-cost-and-model-choice.md).

**A switch to another model has a price.** A provider keeps a cache of the chat for each model. A model that has not seen the chat reads all of it at full price on its first request, and the model you left loses its cache after a few minutes (five with Anthropic, unless a longer time is set). A change of mode on the same model has no such price. In the check, a move between Plan and Execute, the review rules and another effort all left the start of the request as it was; only a change of model did not (18 Nov 2026, OpenCode 2.3.0 with a mock model, so what was seen is the request, not a real cache).

So Relay saves when there is little to read again, or when the other model is far cheaper:

- a new chat, or a chat that has been idle longer than the cache lasts;
- a provider that has no cache;
- a model about seven times cheaper or more. On paper that pays within one to four requests.

It does not save when a long chat moves to a model that is only about twice cheaper, for one question or one small fix. On paper such a move pays only after 6 to 18 requests on the cheaper model.

## What Relay does about it

Since 18 Nov 2026:

- **A step down happens only when it pays.** When your line picks a cheaper model of the same mode, Relay works out what reading the chat again would cost, and what the cheaper model would save over the next requests. It moves the chat only if the saving is at least one and a half times that cost. Otherwise the chat's model stays for that message, the mode still sets the agent, and Recent choices says why. A step up to a dearer model is always made: your line asked for it.
- **The whole chat must fit.** A chat is moved to a model only when the chat so far, with the attached files, fits that model with the room OpenCode keeps free before it compacts a chat.
- **Recent choices shows what each reply took**, so you can see what a switch cost.

The check uses OpenCode's listed prices and a few guesses: a cache that lasts five minutes, 1,500 new tokens in and 500 out for each coming request, and 6 requests for a line until three replies of that line are on record. With no listed price (a plan, a local model, "$0 or not listed") there is no cost check, and your line is followed.

## What you can do

- **In a long chat, use `/relay` at clear points** instead of leaving Relay on: at the first message, and when a plan is approved and the building starts. With Relay on, every message can move the chat.
- **Ask for checks through a helper.** Ask the model to have a helper (a subagent) check the work. A helper is a chat of its own, so nothing is read again and your chat keeps its cache. Relay gives a helper that checks work your Review model.
- **Try one model at two efforts first.** Choose the same model for all three modes, with a higher effort for Plan and Review and a lower one for Execute. The model does not change, so the chat is not read again. Two cautions: a lower effort can do worse work, and on one provider's route an effort change itself was reported to lose the cache in OpenCode 2.3.0.

The limits of this check are in [known limits](status.md#known-limits).
