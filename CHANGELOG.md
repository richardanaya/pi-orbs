# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Product stills, the demo GIF, and the landscape site hero `website/pi-orbs-site-hero.mp4` (1920×1080). Captions match flat π faces, four connectors, and steers in the thread.

## [0.2.0] - 2026-10-02

### Added

- Cross-bot traffic in the open thread. A steer for that bot is a line you can open: who sent it or who received it, the other bot’s face, and the message. A roster orb pulses while that bot is working. The local simulator uses the same lines, including one seeded Ada and Kepler exchange. Its ledger keeps the latest 1000 steers, the same cap as the sprite.
- **Settings → Download all conversations**. One zip of every bot thread as JSON transcripts (id, name, timestamps). API keys and connector credentials are left out. The local simulator returns the seeded threads, or a zip that says there are no conversations when the roster is empty.
- Cross-bot steering. One bot can steer a message into another bot on the same sprite. The server uses Pi’s `whenBusy: "steer"` submit. Those steers show in that bot’s thread as a line you can open. The local simulator records the same exchange. Every bot’s instructions gain a shared need-to-know rule. A steer chain stops after one forward: hop 3, and a second steer of the same incoming message, are refused.
- Bot configuration dialog for create and edit: name, instruction, and a glass-orb look. The instruction is stored on the bot and applied to its Pi conversation, including a later edit. **Delete** in the edit dialog removes that bot. The local simulator accepts and returns the same fields.
- Setup connector types, limited to xAI, OpenAI, Anthropic, and Custom. The default is xAI. One shared model from that form is what every bot uses. The API key stays in the Sprites connection.
- Local simulator API tests in `client/test`. Root `npm test` runs them before the server tests. CI runs them on Node 20 and, with the server tests, on Node 22. No sprite CLI and no xAI key.
- A Local simulator badge on the client page when local mode is on. The Sprite-backed client does not show it.
- [Architecture](docs/architecture.md): client and Sprite, `~/.pi-orbs/state.json`, the xAI connector, shared `/home/sprite/work`, and troubleshooting. The README links to it.

### Changed

- Dialog and Settings use the same black glass chrome as the roster and thread. The bot dialog shows the chosen orb. Settings stacks **Download all conversations**, **Push server build**, and **Destroy sprite**. Focus rings stay on the controls. Motion stays limited to the working pulse.
- Roster. The version and the Peers button are hidden. **Add** is a plus on the right. Faces are flat pi marks in the bot’s color. The site favicon is the current orb.
- Homepage on a phone. The header is one row: the mark, Pi Orbs, and Menu. The hero is the landscape launch video in a 16:9 frame, so the video controls cannot stretch it.
- README and homepage stills show the page, with steers in the thread and no Peers panel. The public try path remains `npx pi-orbs`.
- Brand mark. The app icon, homepage, and README use the white orb with a pi mouth. The Open Graph image is the black lockup of that orb beside the name. Page chrome stays black and white.
- Client UI. Glass-orb avatars, message bubbles, a quieter composer, brand glow, and an empty thread. Setup, roster, thread, add bot, and Settings behave as before.
- Homepage at [piorbs.com](https://piorbs.com/). Spacing, type, screenshot frames, a launch video near the top, and an Open Graph image. The public try path is `npx pi-orbs`. Copy stays on Fly.io Sprites and the sprite CLI.
- README. The public try path is `npx pi-orbs`. Refreshed interface screenshots in `docs/`.
- Version `0.2.0` in the root `package.json`, `server/package.json`, `server/VERSION`, and the private client package. `GET /version` returns `server/VERSION`.

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

[Unreleased]: https://github.com/richardanaya/pi-orbs/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/richardanaya/pi-orbs/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/richardanaya/pi-orbs/compare/bbead96...v0.1.0
[0.0.1]: https://github.com/richardanaya/pi-orbs/commit/6074692
