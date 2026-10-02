# Pi Orbs

[![CI](https://github.com/richardanaya/pi-orbs/actions/workflows/ci.yml/badge.svg)](https://github.com/richardanaya/pi-orbs/actions/workflows/ci.yml)

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

## Use

Until a sprite is running, the page shows only the setup form: a sprite name, an xAI key, and **Create and deploy**. That creates the Sprite, makes its URL public, stores the key in a Sprites connector named `pi-orbs xAI`, and installs the server. The connector id, the sprite URL, and an API secret are written to `~/.pi-orbs/state.json`. The xAI key is not copied into the sprite service environment.

After that, the page is a roster and a thread. The first bot is selected on load. Name a bot and choose **Add**. Each bot is its own Pi conversation. They share `/home/sprite/work`. Send a message in the bar at the bottom. The thread refreshes every few seconds.

**Settings** holds **Push server build** and **Destroy sprite**. Push installs this package's server on the sprite. Destroy deletes that sprite and the connector that was saved with it, then the page returns to setup.

## Publish

`npm publish` from this repo runs the build first. The npm package includes the client, the server `dist`, and the server lockfile the Sprite installs from. `node_modules`, `dist` in git, tarballs, and env files stay out of the repository. The git remote is `git@github.com:richardanaya/pi-orbs.git`.
