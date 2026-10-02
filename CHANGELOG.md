# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
