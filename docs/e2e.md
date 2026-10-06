# End-to-end tests

Browser coverage uses the open-source [TesterArmy `e2e`](https://tester.army/e2e) runner (`e2e` on npm) with the Playwright web engine. This repo does not use a TesterArmy hosted account.

`npm test` does not run these tests. They are `npm run test:e2e` and `npm run test:e2e:live`.

## What runs where

| Command | App | Needs an xAI key |
| --- | --- | --- |
| `npm run test:e2e` | Local simulator on http://127.0.0.1:8787, and the static site (repository root) on http://127.0.0.1:8790 | No. Two `agent.act` steps replay from `.e2e/cache/` when that cache is present. |
| `npm run test:e2e:live` | Local Pi Orbs server talking to xAI, with the client proxied at it on http://127.0.0.1:8787 | Yes. `XAI_API_KEY` or `PIORBS_XAI_API_KEY`. |

The simulator is the same in-memory client as `npm run dev:local`. Chat replies there are canned. The live command is the one that checks a real model reply. It sets `PI_MODEL=grok-4.7` and `PI_API=openai-responses` against `https://api.x.ai/v1`. The key is given only to the server process. The client process does not receive it.

GitHub Actions runs `npm run test:e2e` only, on pull requests and on `master`, with no repository secrets. Live chat stays a local or nightly command so a public pull request never needs the key and the key is never forwarded into CI.

## Node

`e2e` needs Node 22.22.3 or newer, or Node 24.8 or newer. The client and server unit tests still run on the versions in `.github/workflows/ci.yml`. The e2e job pins Node 22.23.3.

## Install

From the repository root, with a compatible Node on `PATH`:

```bash
npm ci
npm ci --prefix client
npm run build --prefix client
npx @e2e-dev/web install chromium --with-deps
```

The live suite also needs the server:

```bash
npm ci --prefix server
npm run build --prefix server
```

## Simulator suite

```bash
npm run test:e2e
```

That runs `node scripts/with-xai-env.mjs npx e2e run`. The wrapper copies `PIORBS_XAI_API_KEY` onto `XAI_API_KEY` inside the process when `XAI_API_KEY` is unset. It does not print either value. The simulator command itself does not receive the key.

Focused files under `tests/`:

| File | Flow |
| --- | --- |
| `onboarding.e2e.ts` | Destroy the sprite, connector presets, create the simulator, seeded roster, setup key stays off the page |
| `bots.e2e.ts` | Add, edit, delete; a steer into Kepler; settings zip download; one agent step that opens Ada's edit dialog |
| `chat.e2e.ts` | Seeded thread and a canned reply after Send |
| `markdown.e2e.ts` | Markdown, images, video, unsafe links, and phone-width tables |
| `mermaid.e2e.ts` | Mermaid diagram, hostile fence, parse fallback, and phone width |
| `tools.e2e.ts` | Working line for a read, and a question card |
| `approvals.e2e.ts` | Allow once, always allow, deny |
| `memory.e2e.ts` | Save and forget a fact |
| `secrets.e2e.ts` | Save and dismiss a secret card; the value stays out of the page and the thread JSON |
| `search.e2e.ts` | Bot, setting, and quoted message; one agent step that opens Search |
| `templates.e2e.ts` | Export and import a template; spawn a bot |
| `main-bot.e2e.ts` | Make Ada primary and check in |
| `schedules.e2e.ts` | Cron key, pause, delete, webhook post, bad token |
| `mcp-events.e2e.ts` | List an MCP event webhook, disconnect it, and refuse the next post |
| `voice.e2e.ts` | Local typed voice line |
| `mobile.e2e.ts` | Phone viewport stacks the roster above the thread |
| `website.e2e.ts` | Homepage headings, copy button, phone nav |

Headless Chromium does not grant clipboard write. The homepage test installs a page-level `navigator.clipboard.writeText` that records the string, clicks **Copy**, and checks the button says **Copied** and the recorded string is `npx pi-orbs`. A spawned bot shows up on the roster because the page refreshes the bot list on the same few-second poll as the thread.

A single file:

```bash
npx e2e run tests/chat.e2e.ts
```

## Live model chat

```bash
npm run test:e2e:live
```

Set `XAI_API_KEY`, or set `PIORBS_XAI_API_KEY` and leave `XAI_API_KEY` unset. `scripts/with-xai-env.mjs`, `e2e/model.ts`, and `scripts/e2e-serve.mjs` perform the same in-process mapping. Do not echo the variable, and do not put it in a test, a report, a screenshot caption, or a pull request.

`tests/live/chat.e2e.ts` creates a bot and waits until an assistant message is non-empty and is not the simulator's canned reply. It does not assert model identity text. The test skips when `XAI_API_KEY` is unset, but the live server process exits before the tests if the key is missing, with a message that does not include the value. Do not add this command to pull-request CI.

The live stack uses a temporary `HOME`, a temporary database, and a generated `PI_API_SECRET`. None of those are written into the repo.

## Agent steps and the replay cache

`agent.act` is cached after a later locator assertion. `agent.assert` always calls the model, so the default suite does not use it.

The first recording of the two `agent` tests needs a model key (`XAI_API_KEY` or `PIORBS_XAI_API_KEY`). The model is `@ai-sdk/xai` `grok-4.7` in `e2e/model.ts`. After a green run, commit `.e2e/cache/` so CI can replay those steps with no key. CI sets the cache to read-only. A stale recording fails the step instead of calling the model only when `--strict-cache` is passed; the default CI job replays and, if a recording is missing, would try a live model call and fail closed because no key is configured.

To record again after a UI change:

```bash
npm run test:e2e
```

with the key in the environment, then commit the updated `.e2e/cache/` entries.

## Voice

The simulator has no microphone and does not call Grok or OpenAI realtime. `tests/voice.e2e.ts` saves a fake voice key, starts the local call, types a line, and stops. A hardware microphone call is not part of this suite.

## Explore

With a key in the environment, a charter against the simulator (no test file is written until a finding is confirmed):

```bash
node scripts/with-xai-env.mjs npx e2e explore "open Settings and confirm the cron key field is a password input"
```

## CI

`.github/workflows/ci.yml` job `e2e` checks out the repo, installs Node 22.23.3, runs `npm ci` and the client install and build, installs Chromium, and runs:

```bash
npx e2e run --reporter list,junit
```

The job sets `E2E_TELEMETRY_DISABLED=1` and does not pass `XAI_API_KEY` or `PIORBS_XAI_API_KEY`. Reports are uploaded as the `e2e-report` artifact (`.e2e/report.json`, `.e2e/junit.xml`). Logs under `.e2e/logs/` are gitignored. The serve script logs URLs only.

A manual live run on a trusted machine:

```bash
npm run test:e2e:live
```

## Secrets

Do not commit `.env` files, `~/.pi-orbs/state.json`, API keys, or `PI_API_SECRET`. Placeholder strings in the simulator tests (`local-setup-key-not-real` and similar) are not credentials. `.e2e/logs/` can contain process stdout; the suite does not print key values, and those logs stay out of git.
