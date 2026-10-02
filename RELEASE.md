# Release

How to cut a version of Pi Orbs. A version bump can merge before anyone tags. The tag, the GitHub Release, and `npm publish` stay with the maintainer, after the release is OK.

## What has to match

These three are the release version. They use the same number, with no `v` prefix (`0.1.0`, not `v0.1.0`):

- Root [`package.json`](package.json) `version` — the `pi-orbs` package on npm.
- [`server/package.json`](server/package.json) `version` — the private server package. Keep the same number in the two root `version` fields of [`server/package-lock.json`](server/package-lock.json). `npm version` updates both.
- [`server/VERSION`](server/VERSION) — the string `GET /version` returns. The client reads this file when it packs a deploy and when it compares a running Sprite.

[`client/package.json`](client/package.json) is private and is not published. Bump it, and the root `version` fields in `client/package-lock.json`, in the same change so the repo does not still say an older version.

## Bump

1. Move notes from `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) into a new `## [x.y.z] - YYYY-MM-DD` section. The date is the day you intend to tag. If the tag lands on a later day, edit that date on `master` before tagging.
2. From the repository root, set that version without creating a git tag:

   ```bash
   npm version x.y.z --no-git-tag-version
   npm version x.y.z --prefix server --no-git-tag-version
   npm version x.y.z --prefix client --no-git-tag-version
   printf '%s\n' x.y.z > server/VERSION
   ```

3. Run `npm test` on Node 22. The `/version` smoke test reads `server/VERSION` and expects the server to return it.
4. Open a pull request. Do not tag, do not open a GitHub Release, and do not `npm publish` from that pull request.

## Tag later

After the bump is on `master` and the release is OK:

```bash
git checkout master
git pull
git tag v0.1.0
git push --tags
```

The tag is `v` plus the version (`v0.1.0` for `0.1.0`). `git tag` does not create the GitHub Release by itself. Pushing the tag does, through the workflow below.

## GitHub Release

Pushing a tag that matches `v*` runs [`.github/workflows/release.yml`](.github/workflows/release.yml). The workflow checks that the tag matches the root `package.json`, `server/package.json`, and `server/VERSION`, then creates a GitHub Release whose notes are the `## [x.y.z]` section of `CHANGELOG.md`. It does not publish to npm.

To create that release by hand instead, open the tag on GitHub and paste the same changelog section.

## npm publish

`npm publish` is a separate maintainer step after the tag, and it needs npm credentials. `prepublishOnly` runs `npm run build` before the pack. Do not publish from a pull request.

### What the tarball includes

The `files` array in the root `package.json` is the allowlist. npm also packs `package.json`. `.npmignore` does not exclude `dist`. `.gitignore` does, so `dist` stays out of git and is produced by the publish build.

| Path | Why it is in the tarball |
| --- | --- |
| `bin/` | The `pi-orbs` bin. `bin/pi-orbs.js` loads `client/dist/main.js`. |
| `client/dist/` | Compiled client. |
| `client/public/` | UI assets. The running client reads them from `client/public`, next to `client/dist`. |
| `server/dist/` | Compiled server. Deploy packs this onto the Sprite. |
| `server/package.json` | Server manifest for `npm install` on the Sprite. |
| `server/package-lock.json` | Lockfile that install uses. |
| `server/VERSION` | Read by the server for `GET /version`, and by the client when it packs a deploy. |
| `README.md`, `LICENSE` | Package metadata. Listed in `files`, and packed by npm either way. |

Left out on purpose: `client/src`, `server/src`, `server/test`, the GitHub Pages site (`index.html` and `website/`), and `node_modules`. The homepage is served from the repository, not from the npm package.
