# pi-orbs

![Glass orbs above a dark desk](docs/hero.jpg)

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

The page has three columns: Sprites, Bots, and the thread.

1. Under Sprites, enter a sprite name and an xAI API key, then choose **Create and deploy**. The client creates the Sprite, makes its URL public, generates an API secret, and installs the server. The key and the secret are written to `~/.pi-orbs/state.json` on your machine and into that Sprite's service environment. They are not stored in this repo.
2. Select the sprite. The line under Bots shows its URL, the server version it is running, and whether this package has a newer build.
3. Name a bot and choose **New bot**. Each bot is its own Pi conversation on that Sprite. They share `/home/sprite/work`.
4. Select the bot and send a message. The thread shows your lines and the bot's replies. It refreshes every few seconds.
5. **Push server build** packs this package's server and installs it on the selected Sprite. Use it when the page says an update is available, or any time you want that Sprite on the build you are running.

The header shows the server build bundled with the client.

## Publish

`npm publish` from this repo runs the build first. The npm package includes the client, the server `dist`, and the server lockfile the Sprite installs from. `node_modules`, `dist` in git, tarballs, and env files stay out of the repository. The git remote is `git@github.com:richardanaya/pi-orbs.git`.
