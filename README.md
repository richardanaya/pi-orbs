# Pi Orbs

[![CI](https://github.com/richardanaya/pi-orbs/actions/workflows/ci.yml/badge.svg)](https://github.com/richardanaya/pi-orbs/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-orbs)](https://www.npmjs.com/package/pi-orbs)
[![License: MIT](https://img.shields.io/github/license/richardanaya/pi-orbs)](LICENSE)

Named Pi bots on one shared Fly.io Sprite — install the client, it deploys the server.

[Contributing](CONTRIBUTING.md)

![Pi Orbs mark, a glass orb whose pi symbol reads as a pair of eyes](docs/logo.png)

Named bots, each one a durable Pi thread, sharing one Fly.io Sprite as their computer.

What you install is the client. The client keeps the Sprite list, creates bots, and pushes a server build onto a Sprite when you ask it to.

## Run

You need Node 20 or newer, and the [sprite CLI](https://sprites.dev) installed and logged in.

```bash
npx pi-orbs
```

Open http://127.0.0.1:8787.

From a checkout of this repo:

```bash
npm install --prefix server && npm install --prefix client
npm run build
npm start
```

## Try locally

Review the roster and thread on this machine with no sprite CLI and no xAI key. `npm run dev:local` builds the client and serves the same UI at http://127.0.0.1:8787 against an in-memory simulator. `PI_ORBS_MODE=local` and `node ./bin/pi-orbs.js --local` select the same mode. Leave the mode off and the client keeps the Sprite paths in **Run** and **Use**.

```bash
npm install --prefix client
npm run dev:local
```

The setup form stays hidden. The roster opens with three bots on a pretend sprite named `atlas`, and the selected thread already has messages.

![Roster of Ada, Kepler, and Nova on the local sprite atlas](docs/local-roster.png)

![Ada's thread with the seeded sample messages](docs/local-thread.png)

Send a message and the simulator appends your text plus a canned reply.

![Ada's thread after a sent message, with the canned reply](docs/local-reply.png)

**Add** creates a bot in memory. **Settings → Push server build** reports success and stops there. **Destroy sprite** returns to the setup form; any sprite name and any placeholder in the key field restore a fresh seeded roster. The placeholder is discarded. Local mode leaves `~/.pi-orbs/state.json` untouched.

**Covers:** the client UI — roster, thread, compose, and adding a bot.

**Outside this mode:** Sprite create, deploy, and destroy; the xAI connector; Pi conversations and tools; the server process that runs on a Sprite.

## Use

Until a sprite is running, the page shows only the setup form: a sprite name, an xAI key, and **Create and deploy**. That creates the Sprite, makes its URL public, stores the key in a Sprites connector named `pi-orbs xAI`, and installs the server. The connector id, the sprite URL, and an API secret are written to `~/.pi-orbs/state.json`. The xAI key is not copied into the sprite service environment.

After that, the page is a roster and a thread. The first bot is selected on load. Name a bot and choose **Add**. Each bot is its own Pi conversation. They share `/home/sprite/work`. Send a message in the bar at the bottom. The thread refreshes every few seconds.

**Settings** holds **Push server build** and **Destroy sprite**. Push installs this package's server on the sprite. Destroy deletes that sprite and the connector that was saved with it, then the page returns to setup.

## Test

From a checkout, after server dependencies are installed:

```bash
npm test
```

That builds the server and runs its smoke tests: `/version` is public, requests without the API secret get 401, and a Bearer token can create a bot and list it. Use Node 22. The server process needs `node:sqlite`, which Node 20 does not include.

## Publish

`npm publish` from this repo runs the build first. The npm package includes the client, the server `dist`, and the server lockfile the Sprite installs from. `node_modules`, `dist` in git, tarballs, and env files stay out of the repository. The git remote is `git@github.com:richardanaya/pi-orbs.git`.
