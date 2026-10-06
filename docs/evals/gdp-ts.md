# Evaluation: gdp-ts for Pi Orbs

Evaluated 2026-10-06. Pi Orbs at `master` `87ec168`. gdp-ts at `main` `ebd0af9` and npm `@gdp-ts/core@0.1.0`.

**Recommendation: skip.** Leave it out of the client, the server, and the Sprite install. The library typechecks against this repo’s TypeScript settings, and it does solve a real class of bug, but that class is not how Pi Orbs is secured today. The package is also one day old, with open reports that a proof can be satisfied for a different id.

## 1. What it is

[gdp-ts](https://github.com/rauchg/gdp-ts) is a small TypeScript library, plus lint presets and an agent skill, implementing [Ghosts of Departed Proofs](https://kataskeue.com/gdp.pdf) (Matt Noonan, 2018). The npm name is `@gdp-ts/core`.

It makes a checked fact visible to the type checker, tied to the exact values that were checked. A function that changes or reveals something sensitive takes a proof about those values. Calling it with no proof, with a raw id, or with a proof about a different id is a compile error. The usual target is authorization (“this user may change this project”) and entitlement (“this project’s plan includes this feature”). The same mechanism can name any precondition.

The runtime does almost nothing. `name()` wraps each value in a frozen `{ value }`. `defineProof()` freezes one `{ kind }` object and hands that same object back from every `prove()`. The safety is the type checker, plus lint rules for the holes TypeScript leaves open (`as`, exporting the prover, calling `defineProof` outside `proofs/`).

It does not decide policy, talk to a database, or replace a policy engine. The check still lives in a small trusted module that you write and test. The library only forces every later call to carry that check’s result, about the same values.

Pi Orbs does not have that shape. One person runs one client, which deploys one Fly.io Sprite. The Sprite server trusts a single `PI_API_SECRET`. Public routes are `GET /version`, the per-bot cron webhook, and the per-bot MCP event webhook. Bot tools, secrets, schedules, and files are scoped by filtering on a bot id inside the function that does the work. There is no second user, and no layer of “data functions anyone can import” that must refuse a call unless a proof is attached.

## 2. API overview

Source of the library: [`src/index.ts`](https://github.com/rauchg/gdp-ts/blob/ebd0af9cae423997a43a024dc6d6738b0895bbec/src/index.ts). Human and agent reference: [`skills/gdp-ts/SKILL.md`](https://github.com/rauchg/gdp-ts/blob/ebd0af9cae423997a43a024dc6d6738b0895bbec/skills/gdp-ts/SKILL.md) and the [README](https://github.com/rauchg/gdp-ts/blob/ebd0af9cae423997a43a024dc6d6738b0895bbec/README.md).

| Export | Role |
| --- | --- |
| `name(a, k)`, `name(a, b, k)`, `name(a, b, c, k)` | Gives one to three values fresh compile-time names, scoped to the callback. Returns whatever the callback returns, including a Promise. Two calls, or two arguments of one call, get incompatible names. |
| `Named<N, A>` | The value inside the callback. Read it with `.value`. `N` is invariant. The only honest constructor is `name()`. |
| `defineProof(kind)` | Returns a `Prover` for one fact kind. Keep the prover private to the module that performs the check. |
| `Prover.prove(...named)` | Mints `Proof<Kind, NamesOf<those values>>`. At runtime it returns the same frozen `{ kind }` every time. |
| `Proof<Kind, About>` | Evidence that `Kind` holds about the tuple of names `About`. Both parameters are invariant. `kind` is a real field, so unions of proofs are discriminated unions. |
| `NameOf`, `NamesOf` | Type helpers. Rarely used outside `prove`. |

The recipe, which is not implemented by the package itself, is in [`skills/gdp-ts/references/recipe.md`](https://github.com/rauchg/gdp-ts/blob/ebd0af9cae423997a43a024dc6d6738b0895bbec/skills/gdp-ts/references/recipe.md):

1. Brand ids in a small `lib/ids.ts` (`string & { brand }`). gdp-ts does not do this.
2. One file per fact under `proofs/`: private `defineProof`, exported interface, exported check that returns the proof or `null`.
3. Policies are unions of those proof interfaces.
4. Sensitive functions take `Named` arguments plus the proof.
5. Handlers call `name()`, turn `null` into the HTTP response, and do the sensitive work inside the callback.
6. Turn on a lint preset.

Lint entry points, all optional peers:

- `@gdp-ts/core/lint/eslint` — `gdp(options?)` for an ESLint flat config.
- `@gdp-ts/core/lint/oxlint` — the same for Oxlint.
- `@gdp-ts/core/lint/plugin` — the rules: `no-define-proof`, `no-exported-prover`, `no-proof-assertion`, `no-type-assertion`, `no-any`.

Default lint mode is targeted. `strict: true` also bans every `as` and `any` outside `proofs/`, with `allowAssertions` defaulting to `**/lib/ids.ts`.

Examples, all on a password-protection story: [`examples/basic`](https://github.com/rauchg/gdp-ts/tree/ebd0af9cae423997a43a024dc6d6738b0895bbec/examples/basic), [`examples/express-basic`](https://github.com/rauchg/gdp-ts/tree/ebd0af9cae423997a43a024dc6d6738b0895bbec/examples/express-basic), [`examples/express-drizzle`](https://github.com/rauchg/gdp-ts/tree/ebd0af9cae423997a43a024dc6d6738b0895bbec/examples/express-drizzle). Limits: [`skills/gdp-ts/references/limits.md`](https://github.com/rauchg/gdp-ts/blob/ebd0af9cae423997a43a024dc6d6738b0895bbec/skills/gdp-ts/references/limits.md).

A scratch file outside this repo, typechecked with `typescript@5.9.3` and `@gdp-ts/core@0.1.0` under Pi Orbs’ compiler settings (`strict`, `module`/`moduleResolution` `Node16`, `"type": "module"`), accepted a proof about the job id that was checked and rejected the same proof for a different named job id (`TS2345` on the phantom `ABOUT` slot). The package imports cleanly into an ES module. This repo’s `server/package.json` and `client/package.json` are already `"type": "module"`.

## 3. Maturity, license, dependencies, constraints

| | |
| --- | --- |
| Repository | https://github.com/rauchg/gdp-ts (default branch `main`) |
| Created | 2026-10-04 |
| History | One commit, `ebd0af9`, authored 2026-10-04 and committed 2026-10-05. No tags. No GitHub releases. |
| npm | `@gdp-ts/core@0.1.0`, published 2026-10-05. Only version. `latest` is `0.1.0`. |
| Attention | About 558 stars and 15 forks on 2026-10-06. The npm downloads API returned 404 for this package name on that date, so there is no public download count. |
| License | MIT. Copyright 2026 Guillermo Rauch. Compatible with Pi Orbs’ MIT license. |
| Runtime dependencies | None. |
| Packed size | 18 files, about 61 KB unpacked. `dist/` is plain ESM plus `.d.ts`. `src/` is also published. |
| Peer dependencies | Optional: `typescript >= 5.4`, `eslint >= 9`, `oxlint >= 1.86`. |
| `engines` | None. Library `tsconfig` targets ES2022. No native addons, no `node:` builtins. |
| TypeScript | Documented minimum 5.4. CI type-tests 5.4, 5.5, 5.6, 5.9, 6.0, and 7. Pi Orbs uses `typescript` `^5.9.0` and `"strict": true` in both `server/tsconfig.json` and `client/tsconfig.json`. |
| Node | Fine on the client’s Node 20 and on the server’s Node 22. The Sprite runs `/.sprite/bin/node` and `npm install --omit=dev` from `server/package.json`. A dependency here would be installed on every Sprite. TypeScript itself would not be. |

Maintenance risk is high relative to the star count. The author is a strong signal, the tests and the skill are unusually complete for a first commit, and npm trusted publishing is described as staged on `v*` tags. There is still no second commit, no published tag, and no semver history. Open reports on 2026-10-05 already include holes in the guarantee:

- [Issue 11](https://github.com/rauchg/gdp-ts/issues/11). Spreading a `Named` value keeps the phantom name and replaces `.value`. A proof about project A then typechecks for project B’s id. No `as`, and the lint preset does not catch it. The suggested fix is to make `Named` a class with a private field.
- [Issue 13](https://github.com/rauchg/gdp-ts/issues/13). Strict lint mode still accepts `null!`, a value already typed `any` (such as `JSON.parse(...).proof`), and a `never` value such as `[][0]`.
- [Issue 14](https://github.com/rauchg/gdp-ts/issues/14). Several documented errors disappear when `strictNullChecks` or `strictFunctionTypes` is off. Pi Orbs has `strict: true`, so this particular hole is closed here. It is still undocumented upstream.
- [Issues 3 and 16](https://github.com/rauchg/gdp-ts/issues/3). The lint rules miss some `defineProof` spellings, including a re-export through a local module.

A proof says the fact held when it was checked. It goes stale if the row changes before the write. The `name()` callback keeps the proof lexically request-scoped. It does not take a lock. Pi Orbs’ JSON files (`bots.json`, `secrets.json`, `schedules`, `mcp-events.json`) are read-modify-write with in-process queues, which is a different mechanism.

Pi Orbs has no ESLint or Oxlint config. Adopting the library without a preset leaves `as` as a forge path. Adopting `strict` lint would collide with the `as` casts already used to read JSON in `server/src/server.ts`, `server/src/features.ts`, `client/src/main.ts`, and `client/src/sprite.ts`.

## 4. Where it could plug in

These are the seams where a proof would be about a real value Pi Orbs already checks. Effort is S (one module and its tests), M (that seam plus the copy in `client/src/local.ts` or the duplicated feature module), L (a shared proof layer, branded ids, and a linter, across client and server).

`client/src/features.ts` and `server/src/features.ts` are the same file (694 lines, byte-identical). Any proof types added to one have to be copied or the simulator drifts. There is no shared package today.

### 4.1 Cron job id vs bot id

`deleteCronJob` and `setCronJobEnabled` in `server/src/schedule.ts` take a raw `jobId: number` and the cron-job.org key. They PATCH or DELETE `/jobs/${jobId}` on that account. Ownership is a separate `find`:

- `setScheduleEnabled` / `deleteOneSchedule` in `server/src/server.ts` (around lines 380–396) keep the job only when `item.botId === botId && item.jobId === jobId`, then call the raw helper with the number.
- `client/src/local.ts` does the same find (around lines 1048–1084) and then calls `deleteCronJob` / `setCronJobEnabled` with the URL’s `jobId`.

A model tool passes `jobId` from the model (`pause_schedule`, `resume_schedule`, `delete_schedule` in `server/src/server.ts`). The conversation id is the bot id. The dangerous future edit is a new caller of `deleteCronJob` that skips the find.

A proof `JobOwnedByBot<B, J>` minted only inside the find, demanded by `deleteCronJob` and `setCronJobEnabled`, would make that skip a type error. `name()` accepts at most three values, which is enough for bot id plus job id.

**Pros.** This is the closest match to the library’s “checked A, acted on B” story. The trusted check is a one-line lookup. The sensitive functions are already separated from it.

**Cons.** Both call sites already do the lookup in the same function that calls the helper. The bug is hypothetical. `jobId` is a number on a single cron-job.org account; branding it and threading `Named` through `memoryCron()` and `fetchCron()` touches the schedule tests. The simulator must change in lockstep.

**Effort.** M.

**Risks.** A wrong proof (issue 11’s object spread) would typecheck a cross-bot delete. The cron key still sits in the helper’s arguments, so a proof about the job does not stop the key from being logged. Tests in `server/test/schedule.test.js` and `client/test/local.test.js` already cover “schedule not found” and webhook auth.

### 4.2 Cron webhook token vs bot

`POST /hooks/:token` is unauthenticated. `server/src/server.ts` (around lines 1227–1248) decodes the token, `tokensEqual`s it to `bot.hookToken` (`server/src/schedule.ts` lines 67–72, `timingSafeEqual`), and submits `message.content` on `conversationFor(bot.id)`. `client/src/local.ts` (around lines 793–818) does the same and calls `submitHuman(bot, ...)`.

The token is the only credential. The body is `{ content }` and does not carry a bot id. The submit target is the bot object the compare returned.

**Pros.** This is a real trust boundary. A later edit that submitted to a bot id from the body would be the bug gdp-ts is for. `HookTokenUnlocksBot<T, B>` demanded by a small `submitHook(bot, proof)` would keep the token and the conversation together.

**Cons.** There is one call site on the server and one in the simulator. The compare and the submit are already adjacent. The valuable part of `tokensEqual` is constant-time comparison, which a proof does not provide. The proof’s runtime value is `{ kind: "HookTokenUnlocksBot" }`, so it must not be built from the token or the check is theater.

**Effort.** S on the server, M once `local.ts` is included.

**Risks.** Low product risk for a spike, and low payoff. Forgetting to copy the proof into the simulator would make local and Sprite behavior diverge in the type system only.

### 4.3 MCP event webhook vs bot

`receiveMcpWebhook` in `server/src/mcp-events.ts` (lines 159–212) finds the hook by token, checks the Standard Webhooks signature against that hook’s `whsec_` secret, and returns `deliver.botId` as a plain string. The HTTP handler in `server/src/server.ts` (around lines 1263–1286) looks the bot up again and `submit`s `deliver.content` with `whenBusy: "followUp"`.

**Pros.** Same shape as the cron hook, with a sharper mix-up: the deliver object carries `botId`, `content`, and `requestId` as independent strings. A proof returned next to `botId` would make `conversationFor(someOtherId)` fail to compile. Signature checks stay in the trusted module, which is what the recipe wants.

**Cons.** Delivery is one function returning one object, consumed in one place. `server/test/mcp-events.test.js` already locks the signature, the timestamp window, and the bot the event lands on. The simulator does not implement this route, so at least the duplication cost is lower here than for cron.

**Effort.** S.

**Risks.** The proof cannot see signature bypasses, replay (`hook.seen`), or a bot that was deleted between verify and submit (the handler already returns 410). Those stay runtime tests.

### 4.4 Bot-scoped vault, approvals, memory, files, questions

`readSecret`, `fulfillSecret`, `deleteSecret`, `reviewAction`, `resolveApproval`, `saveMemory`, and `forgetMemory` in `server/src/features.ts` (and the identical `client/src/features.ts`) take a raw `botId: string` and filter with `item.botId === botId`. Callers pass the conversation id from the route or the tool, not an id the model chose for another bot.

File download uses the same filter: `server/src/server.ts` around line 1638 finds `item.id === leaf && item.botId === bot.id`. `uploadFile` (lines 489–495) only allows paths under `uploads/` inside `PI_CWD`. Questions use `item.botId === bot.id` before `conversation.submit`.

**Pros.** If a tool later accepted a bot id argument, `SecretOfBot<B>` would stop `readSecret` from returning another bot’s value. That would matter, because `read_secret` returns the raw value into the tool result (`server/src/server.ts`, secrets extension).

**Cons.** Today the bot id and the row filter are the same parameter of the same function. Turning each filter into a proof splits every helper, then duplicates the split into the client copy. Branded `BotId`s would ripple through roster JSON, which is stored and parsed with `as`. Approvals also depend on command class, TTL, and “allow once” consuming a grant (`reviewAction`, lines 568–628). A proof that a card is pending does not encode “this grant matches this exact command” unless that string is named too. `name()` stops at three values.

**Effort.** L.

**Risks.** High chance of a client/server drift. Strict lint fights the JSON `as` casts in this file. A forged or spread `Named` on `readSecret` would be a cross-bot secret read that the types claim is impossible.

### 4.5 Voice session vs URL bot id

`findSession(sessionId, botId)` in `client/src/voice.ts` (lines 192–196) returns null when the session’s `botId` differs. `handleLiveVoice` in `client/src/main.ts` (around lines 335–386) uses that session, then `spriteFetch`es `/api/bots/${match.botId}/messages` for `send_task` and loads chat lines with `match.botId`. After the find, `session.botId` and `match.botId` are the same string only because `findSession` compared them.

**Pros.** A `SessionForBot<S, B>` demanded by `executeVoiceTool` would keep the tool on the session’s bot if someone later passed `match.botId` through a different variable.

**Cons.** The compare is the lookup. Voice sessions live in one process `Map` on the client. They are not a multi-user boundary. The stored voice key is kept off the page by `publicSession` simply omitting it.

**Effort.** S.

**Risks.** The short-lived provider `clientSecret` is the sensitive value, and it is minted before the session exists (`mintClientSecret` then `openSession`). A session proof does not cover that mint.

### 4.6 The API secret gate

`authorized()` in `server/src/server.ts` (lines 656–664) compares `Authorization: Bearer` or `x-api-key` to `PI_API_SECRET` with `timingSafeEqual`. The HTTP server calls it once (around line 1299) after `/version`, `/hooks/:token`, and `/api/mcp-events/:token`. Everything else is behind that boolean.

**Pros.** A `RequestCarriesApiSecret` proof demanded by each handler would catch a new route that forgot the check, if routes were split into functions that can be called on their own.

**Cons.** The gate is one early return in one callback. Forgetting it means inserting a route above line 1299, which is the pattern already used for the two intentional public POSTs. Wrapping every branch in `name()` would rewrite `server.ts` (about 2,100 lines) and `client/src/local.ts` (about 1,450 lines) without a second principal to distinguish. The client on `127.0.0.1:8787` is the operator’s process. It does not check `PI_API_SECRET` for the page. It attaches the secret when it calls the Sprite (`spriteFetch` in `client/src/main.ts`).

**Effort.** L.

**Risks.** A proof around `authorized()` can be minted from a boolean the same way today’s `if (!authorized(req))` can be skipped. The type checker only helps if every state-changing function is unreachable without the proof. That is a router rewrite.

### 4.7 Peer hop chain

`outgoingHop` and `peerChainUsed` in `server/src/peers.ts` close the steer chain: hop 1 from a human turn, hop 2 from that recipient, then `"peer chain is closed"`. `steerPeer` in `server/src/server.ts` (lines 591–633) also refuses `fromId === targetId`. The tool path recomputes the hop from the current turn (`steer_peer` around the `outgoingHop(turn)` call).

**Pros.** `ChainOpen` could be demanded by a local wrapper around `conversation.submit` for steers.

**Cons.** The fact is parsed out of message text (`peerTurn` reads `pi-orbs-peer-hop:`). It is not a relationship between two ids that can be swapped at the type level. `submit` belongs to `@earendil-works/pi-durable`. Pi Orbs cannot change that signature. The hop counter is the policy. A proof would wrap the same function.

**Effort.** M, for a wrapper that the durable harness does not see.

**Risks.** Easy to “prove” the hop in the tool and then have `POST /api/bots/:id/steer` submit with a different hop. Both paths would have to demand the same proof or the types lie.

### 4.8 Redaction, public JSON, and the Sprite env

`publicSprite` (`client/src/main.ts` lines 199–211) returns name, URL, connector, model, `voice: { provider, configured }`, and `cron: { configured }`. `serviceEnv` (lines 179–197) puts `XAI_API_KEY=connector` and `OPENAI_API_KEY=connector` on the Sprite, and copies `CRON_JOB_ORG_API_KEY` only when a key is saved. Export redacts long secrets in `transcript` (`server/src/server.ts` around lines 702–736) and in `client/src/archive.ts`.

**Pros.** None that gdp-ts is built for. A proof does not track “this string has had these substrings removed.”

**Cons.** The page stays safe because the secret fields are omitted, and because tests search the response body for the key (`client/test/local.test.js`). `publicSprite`’s `...extra` can still spread a secret if a caller passes one. That is a review problem on a single function, solved by a narrower return type, which Pi Orbs can do with an ordinary TypeScript type.

**Effort.** S for a return type. Not a gdp-ts change.

**Risks.** Putting redaction behind a proof would invite a cast at the one `JSON.stringify` boundary and add no runtime filtering.

### 4.9 Connectors, durable conversations, deploy

Not fit points. `client/src/sprite.ts` and `client/src/connectors.ts` store one Sprites token and one `custom_api` connector. `client/src/deploy.ts` packs the server and recreates the `web` service. `server/src/model.ts` points Pi at the Sprites gateway. `@earendil-works/pi-durable` owns conversation ids and `submit`. gdp-ts does not wrap HTTP clients, Fly’s API, or another library’s agent loop. Branding a connector id would not stop the client from sending the wrong bearer token. That token is process state.

## 5. What already covers these seams

- One boolean gate, `authorized()`, with `timingSafeEqual`. `server/test/api.test.js` asserts 401 for a missing secret, a missing header, and a wrong secret. `GET /version` is the tested public exception.
- `tokensEqual` for cron hooks, also constant-time, with a length cap. `client/test/local.test.js` posts a webhook with the cron-job.org key and expects rejection. The token in the path is what authorizes the post.
- `receiveMcpWebhook` checks token, `webhook-id`, timestamp skew, and HMAC before it returns a bot id. `server/test/mcp-events.test.js` covers that path.
- Schedule mutations look up `(botId, jobId)` before `setCronJobEnabled` / `deleteCronJob`. `server/test/schedule.test.js` and the local simulator tests cover invalid cron, a missing key, and a job that belongs to the bot.
- Vault and approval helpers take the bot id and filter inside the function. `server/test/features.test.js` covers secrets and approvals. `readSecret` is the only way the model sees a value. The page’s `publicVault` returns names only.
- `findSession(sessionId, botId)` refuses a mismatched pair. `client/test/voice.test.js` covers the voice routes.
- `outgoingHop` / `peerChainUsed` / `resolvePeerTarget` are pure and tested in `server/test/peers.test.js`, including self-steer and `"peer chain is closed"`.
- Path checks in `uploadFile` keep files under `PI_CWD/uploads`.
- `publicSprite`, `publicVoice`, and `publicCron` drop keys by not copying them. The local tests assert the response text does not contain the saved key.
- Zod is a root devDependency for the e2e runner (`e2e/model.ts`). It is not on the server and it checks shapes, which gdp-ts also says is a different job from relating two specific values.

Neighboring libraries do not overlap. `@earendil-works/pi-ai`, `@earendil-works/pi-durable`, and `@earendil-works/chord` are the agent stack. They do not mint compile-time proofs.

## 6. Recommendation

**Skip.**

Pi Orbs’ sensitive steps already sit next to their checks, in one process, for one operator. gdp-ts pays off when many callers can reach a function and the bug is “the check used a different id” or “the check was dropped.” That payoff is not available in `server.ts`, `local.ts`, or `features.ts` as they are written. The places that look like a fit (cron job ids, hook tokens, MCP `deliver.botId`, voice sessions) are single call sites.

The package is `@gdp-ts/core@0.1.0` with one commit. Issue 11 shows a `Named` spread that keeps the proof and swaps the id, which is the bug the library claims to close. Putting that on `readSecret` or `deleteCronJob` would make a cross-bot action look checked. Pi Orbs also has no linter, and the existing `as` casts mean the strict preset is a project of its own. `client/src/features.ts` and `server/src/features.ts` would have to carry every proof twice.

A Sprite install of a compile-time helper is the wrong dependency direction. The runtime pieces are small and have no dependencies, and TypeScript 5.9 in this repo can import them. That compatibility is not a reason to adopt.

Do not add the skill (`npx skills add rauchg/gdp-ts`) on its own. The skill tells an agent to demand proofs. This codebase does not have them, so the skill would invent a `proofs/` tree on the next auth edit.

No application code in this evaluation. No dependency bump. No version change.

## 7. If this is reopened later

There is no implementation step now.

Reconsider only if both of these are true: `@gdp-ts/core` has closed the `Named` spread hole in a release after 0.1.0, and Pi Orbs has grown a second principal (a tool argument that is another bot’s id, a per-bot credential, or a shared Sprite with more than one operator).

If that happens, the spike is one proof, not a migration:

1. Add `@gdp-ts/core` only as a dev experiment on a branch. Do not put it in the Sprite `dependencies` until the spike is worth keeping.
2. Brand `BotId` and cron `JobId` in one small file.
3. Change `deleteCronJob` and `setCronJobEnabled` so they require `JobOwnedByBot<B, J>` minted by the existing `(botId, jobId)` find.
4. Do the same in `client/src/local.ts`. Leave `features.ts` alone.
5. Add one `@ts-expect-error` line that passes a proof for job A into a delete of job B, next to the schedule tests.
6. Turn on the non-strict ESLint or Oxlint preset only for the new `proofs/` file and those two helpers. Leave the rest of the `as` casts alone.

Stop there. Do not wrap `authorized()`, `readSecret`, or `conversation.submit` in that spike.
