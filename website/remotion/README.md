# Pi Orbs Remotion

Nested Remotion project for the Pi Orbs **0.3 release / product video**.
It lives here so root `npm run build` and CI stay on the client and server.

Composition: **`PiOrbs030`** — 1920×1080, 30 fps, 32 seconds (960 frames).

## Preview

From this directory:

```bash
npm install
npm run preview
```

That is `remotion studio --public-dir ..`. The site hero footage is
`website/pi-orbs-site-hero.mp4`, served from the parent folder.

## Render

```bash
npm run render
```

Writes `website/remotion/out/pi-orbs-0.3-release.mp4`.

Poster still (title + π-face, frame 90):

```bash
npm run still
```

Copy the site deliverables from `out/` after a render:

```bash
cp out/pi-orbs-0.3-release.mp4 ../pi-orbs-0.3-release.mp4
cp out/launch-poster.jpg ../launch-poster.jpg
```

Typecheck:

```bash
npm run check
```

## Beat sheet

| Time | Frames | Beat |
| --- | --- | --- |
| 0.0–5.3s | 0–160 | Title: live π-face (`look="silver"`) + **Pi Orbs** + 0.3 |
| 4.3–7.3s | 128–220 | Tagline: Named Pi bots on one shared Fly.io Sprite |
| 6.7–18.1s | 200–542 | Product: `OffthreadVideo` of `pi-orbs-site-hero.mp4`, trimmed to the live app (skips the old 0.2 orb open and the v0.2.0 end card). Captions: Sprites API token, optional voice, scheduled messages, MCP event webhooks |
| 17.6–24.7s | 528–740 | Brand: pastel π-face row. Live π-face — pastels, dark teal eyes, traced π, blush |
| 23.7–32.0s | 710–960 | CTA: **`npx pi-orbs`** and piorbs.com |

The π-face in `src/PiFace.tsx` is a frame-driven port of [`website/pi-face.js`](../pi-face.js). Keep the path, looks, ink, and blush in sync with that file.

## Public try path

The video CTA is **`npx pi-orbs`** only. Do not invent alternate install commands.
