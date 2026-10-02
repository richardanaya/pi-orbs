## Summary

<!-- What changed and why. -->

Closes #

## How to check

<!-- Commands you ran, or which docs you compared against the code. -->

- [ ] `npm run build` (builds the server, then the client)
- [ ] `npm test` (client simulator API tests, then server auth and bots smoke tests; full run needs Node 22)

## Checklist

- [ ] The change stays focused
- [ ] No xAI API keys, `PI_API_SECRET` values, or `~/.pi-orbs/state.json` contents
- [ ] The xAI key stays in the Sprites connector `pi-orbs xAI`, and is not added to the Sprite service environment
