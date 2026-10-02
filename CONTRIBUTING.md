# Contributing

Thanks for helping with Pi Orbs. This guide covers a local checkout: install, build, run, and what a pull request should include.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues the way [SECURITY.md](SECURITY.md) describes.

## Prerequisites

- Node.js 20 or newer
- npm
- The [sprite CLI](https://sprites.dev), installed and logged in, when you create or manage a Sprite

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

## Run locally

```bash
npm start
```

The client listens on http://127.0.0.1:8787. `npm start` runs `node ./bin/pi-orbs.js`, which loads `client/dist`, so build before you start.

Creating a Sprite from that page needs the sprite CLI and an xAI key. The key is stored in a Sprites connector named `pi-orbs xAI`. It is not written into the Sprite service environment. See [SECURITY.md](SECURITY.md).

## Pull requests

- Keep the change focused on one problem.
- Run `npm run build` and describe how you checked the change.
- Match the existing TypeScript style (`strict`, ESM, Node 20).
- Leave generated output out of the commit: `node_modules`, `dist`, tarballs, and env files.
- Leave secrets out of the commit and the pull request. That includes xAI keys, `PI_API_SECRET`, and `~/.pi-orbs/state.json`.
- Link the issue the change closes.
- Do not publish to npm, and do not deploy a shared Sprite, as part of a code or docs change. Publishing is the maintainer's `npm publish` step; `prepublishOnly` already runs the build.

There is no test script in this repo yet. A green `npm run build` is the check to report.
