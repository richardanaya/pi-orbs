# Security

## Reporting a vulnerability

Report vulnerabilities privately. Email [richard.anaya@gmail.com](mailto:richard.anaya@gmail.com), or open a draft advisory at https://github.com/richardanaya/pi-orbs/security/advisories/new if private vulnerability reporting is enabled on this repository.

Include what is affected, the impact, and a reproduction that uses placeholders for secrets. Allow time for a fix before any public write-up.

Use a public GitHub issue only for bugs that do not expose credentials, private Sprite state, or an exploitable weakness. Never paste an xAI API key, a `PI_API_SECRET` value, or the contents of `~/.pi-orbs/state.json` into an issue, pull request, log, or commit.

## API secrets and the xAI key

The local client (http://127.0.0.1:8787) is what you install. It creates one Fly.io Sprite and deploys the server. Two secrets matter:

- **API key.** The setup form sends the key to the client on your machine. The client stores it in a Sprites `custom_api` connection (header bearer token). xAI reuses the connection named `pi-orbs xAI`. Requests from the bots go through the Sprites gateway for that connection (`PI_BASE_URL`). The Sprite service environment receives `XAI_API_KEY=connector` and `OPENAI_API_KEY=connector`, placeholders, not the key. The API key must not live in the Sprite service environment. The page never receives it.
- **API secret.** The client generates `PI_API_SECRET` and sends it to the server as `Authorization: Bearer` (or `x-api-key`). The server compares it with `timingSafeEqual`. Routes other than `GET /version` reject requests when the secret is missing or wrong. `GET /version` is unauthenticated, and the Sprite URL is public.

`~/.pi-orbs/state.json` holds the sprite name and URL, the API secret, the xAI key, and the connector id. That file stays on the machine that runs the client. Do not commit it, copy it into chat, or check it into CI. `.gitignore` already ignores `.env`, `.env.*`, `*.pem`, `*.key`, and `.pi-orbs`.

Destroying the sprite from the client deletes the Sprites connector saved with it.

If a key or API secret was committed, pasted in public, or written into a Sprite service environment, revoke it and report that as a vulnerability using the contact above.
