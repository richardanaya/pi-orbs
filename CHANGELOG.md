# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Cross-bot traffic inspector. **Peers** opens a panel beside the thread (under it on a narrow window) and lists steers: who sent it, who received it, when, and the message. The open thread stays the conversation with you. A roster orb pulses while that bot is working. The local simulator uses the same panel, including one seeded Ada and Kepler exchange.
- **Settings → Download all conversations**. One zip of every bot thread as JSON transcripts (id, name, timestamps). API keys and connector credentials are left out. The local simulator returns the seeded threads, or a zip that says there are no conversations when the roster is empty.
- Cross-bot steering. One bot can steer a message into another bot on the same sprite. The server uses Pi’s `whenBusy: "steer"` submit. The open thread leaves that traffic out. The local simulator records the same exchange.
- Bot configuration dialog for create and edit: name, instruction, and a glass-orb look. The instruction is stored on the bot and applied to its Pi conversation, including a later edit. The local simulator accepts and returns the same fields.
- Setup connector types. The default is xAI. OpenAI, OpenRouter, Groq, Together AI, DeepSeek, Mistral, Fireworks, and Custom are the other choices. One shared model from that form is what every bot uses. The API key stays in the Sprites connection.
- Local simulator API tests in `client/test`. Root `npm test` runs them before the server tests. CI runs them on Node 20 and, with the server tests, on Node 22. No sprite CLI and no xAI key.
- A Local simulator badge on the client page when local mode is on. The Sprite-backed client does not show it.
- [Architecture](docs/architecture.md): client and Sprite, `~/.pi-orbs/state.json`, the xAI connector, shared `/home/sprite/work`, and troubleshooting. The README links to it.

### Changed

- Client UI. Glass-orb avatars, message bubbles, a quieter composer, brand glow, and an empty thread. Setup, roster, thread, add bot, and Settings behave as before.
- Homepage at [piorbs.com](https://piorbs.com/). Spacing, type, screenshot frames, a launch video near the top, and an Open Graph image. The public try path is `npx pi-orbs`. Copy stays on Fly.io Sprites and the sprite CLI.
- README. The public try path is `npx pi-orbs`. Refreshed interface screenshots in `docs/`.

## [0.1.0] - 2026-10-02

### Added

- GitHub Actions CI on `master` and pull requests. It builds on Node 20 and Node 22, and runs the server tests on Node 22.
- OSS hygiene: [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), and GitHub issue templates.
- Local simulator, `npm run dev:local` (also `PI_ORBS_MODE=local` or `node ./bin/pi-orbs.js --local`). Seeded roster and thread, canned replies, no sprite CLI and no xAI key.
- Server smoke tests for a public `GET /version`, rejected requests without the API secret, and creating and listing a bot with a Bearer token. `npm test` runs them, and CI runs them on Node 22.
- README screenshots of the local roster, thread, and canned reply.
- Static homepage for GitHub Pages: [`index.html`](index.html) at the repository root, with the stylesheet, script, and mark in [`website/`](website/).
- [RELEASE.md](RELEASE.md), and a workflow that opens a GitHub Release from the matching section of this file when a `v*` tag is pushed. The workflow does not publish to npm.

### Changed

- Version `0.1.0` in the root `package.json`, `server/package.json`, and `server/VERSION`. `GET /version` returns `server/VERSION`. The private client package uses the same number.

## [0.0.1] - 2026-10-02

### Added

- Initial client and server. `npx pi-orbs` runs the client, which deploys the server onto one shared Fly.io Sprite. Named bots are durable Pi threads on that sprite.
- The xAI key is stored in the Sprites connector `pi-orbs xAI`, not in the sprite service environment.
- Pi Orbs mark.

There was no `v0.0.1` git tag.

[Unreleased]: https://github.com/richardanaya/pi-orbs/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/richardanaya/pi-orbs/compare/bbead96...v0.1.0
[0.0.1]: https://github.com/richardanaya/pi-orbs/commit/6074692
