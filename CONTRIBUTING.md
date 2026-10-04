# Contributing

Thanks for helping with Pi Orbs. This guide covers a local checkout: install, build, run, and what a pull request should include.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues the way [SECURITY.md](SECURITY.md) describes. How the client, the Sprite, and the bots fit is in [Architecture](docs/architecture.md).

## Prerequisites

- Node.js 20 or newer
- npm
- The [sprite CLI](https://sprites.dev), installed and logged in, when you create or manage a Sprite. `npm run dev:local` does not use it.

Building the TypeScript does not need the sprite CLI or an xAI key.

## Install

From the repository root:

```bash
npm install --prefix server && npm install --prefix client
```

The root `package.json` has no dependencies of its own. Server and client dependencies live in those two packages.

## Build

```bash
npm run build
```

That script builds the server, then the client (`npm run build --prefix server && npm run build --prefix client`). Each package runs `tsc`. Output lands in `server/dist` and `client/dist`. Those directories are gitignored.

## Test

```bash
npm test
```

`npm test` at the repo root runs the client simulator tests, then the server package tests. Both use Node's built-in test runner. No sprite CLI and no xAI key.

The client tests call the in-memory simulator in `client/src/local.ts` over HTTP. They check the seeded sprite `atlas` and `localVersion`, the bots Ada, Kepler, and Nova, the seeded thread, a zip of those conversations (`pi-orbs-conversations` version 1, including an empty roster and several bots, with secrets redacted), a canned assistant reply, creating a bot, name, instruction, and look on create and edit, peer steers through the peers API and ledger, with the Peers panel absent, connector presets and the shared model, optional Grok or OpenAI voice setup, a local voice call whose agent has only search, send-task, and stop, an optional cron-job.org key that is not returned to the page, a stubbed cron job whose webhook posts into that bot as a normal message, and stubbed deploy and destroy. Voice tests do not call Grok or OpenAI. Schedule tests do not call cron-job.org. Deploy and destroy do not write `~/.pi-orbs/state.json`. After destroy, the sprite is gone, and create reseeds it. Node 20 can run these on their own:

```bash
npm test --prefix client
```

The server tests build the server, then start it on a free port with a throwaway database and `PI_API_SECRET`, and check `/version` is public, a missing or wrong secret gets 401, a Bearer token can create a bot and list it, and `GET /api/export` returns those transcripts without the API secret.

The server process uses `node:sqlite`, which Node 20 does not include, so the full `npm test` needs Node 22. CI runs `npm test` on the Node 22 job, and runs `npm test --prefix client` on the Node 20 job. Both jobs build both packages.

## Run locally

```bash
npm start
```

The client listens on http://127.0.0.1:8787. `npm start` runs `node ./bin/pi-orbs.js`, which loads `client/dist`, so build before you start.

Creating a Sprite from that page needs the sprite CLI and an xAI key. The key is stored in a Sprites connector named `pi-orbs xAI`. It is not written into the Sprite service environment. See [SECURITY.md](SECURITY.md).

## UI simulator

`npm run dev:local` builds the client and opens the same page against an in-memory simulator. No sprite CLI, no Sprite, and no xAI key. The roster starts with seeded bots and a thread. Sending a message appends a canned reply. The simulator leaves `~/.pi-orbs/state.json` untouched.

The page shows a **Local simulator** badge while this mode is on. The badge sits above the setup form and the roster, not inside Settings. `GET /api/sprites` returns `simulator: true` only from the in-memory handler, and that flag is what turns the badge on. The Sprite-backed client does not send the flag, and the badge stays hidden there.

Create, deploy, and destroy are stubbed in local mode. They succeed without calling the sprite CLI or installing a server, and they do not write `~/.pi-orbs/state.json`. Destroy clears the in-memory sprite. Creating again reseeds Ada, Kepler, and Nova.

```bash
npm install --prefix client
npm run dev:local
```

`PI_ORBS_MODE=local` or `node ./bin/pi-orbs.js --local` is the same switch. With the mode off, `npm start` is the Sprite-backed client above.

The simulator covers the roster, thread, compose box, and adding a bot. The xAI connector, Pi conversations, and the server that runs on a Sprite stay on the real path. Screenshots of this UI are in the README under **The interface**. The public try path is `npx pi-orbs`, not this simulator.

## Pull requests

- Keep the change focused on one problem.
- Run `npm run build` and `npm test`, and describe how you checked the change.
- Match the existing TypeScript style (`strict`, ESM, Node 20).
- Leave generated output out of the commit: `node_modules`, `dist`, tarballs, and env files.
- Leave secrets out of the commit and the pull request. That includes xAI keys, `PI_API_SECRET`, and `~/.pi-orbs/state.json`.
- Link the issue the change closes.
- Do not publish to npm, and do not deploy a shared Sprite, as part of a code or docs change. Publishing is the maintainer's `npm publish` step; `prepublishOnly` already runs the build.
- Do not create a `v*` tag or a GitHub Release from a pull request. [RELEASE.md](RELEASE.md) is the bump and the later tag (`git tag v0.1.0 && git push --tags` once the bump is on `master` and the release is OK).

A green `npm run build` and `npm test` are the checks to report.
