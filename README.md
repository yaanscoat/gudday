# gudday

A web proxy and game library that runs entirely as static files. No server, no build step, no host config.

## Host it on GitHub Pages

1. Push this repo to GitHub (the `vendor/` folder must be committed).
2. In the repo, open **Settings > Pages**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, then save.
3. Open `https://<you>.github.io/<repo>/`.

Any other static host (Cloudflare Pages, Netlify, a plain web server) works the same way: serve the repo root over HTTPS.

## Run it locally

```bash
npm install          # also copies the proxy runtime into vendor/
npm run dev          # http://localhost:8080/
npm run dev -- --base /gudday/   # same, but under a subpath like GitHub Pages
```

## How it works

| Part | What it does |
| --- | --- |
| `index.html`, `styles.css`, `js/` | The app: home search, games, browser, settings |
| `sw.js` | Service worker: routes proxied pages through Scramjet and caches the app for fast reloads |
| `vendor/` | Scramjet, its controller and utils, and the Epoxy Wisp transport (copied by `npm run vendor`) |
| `changelog.json` | Shown in Settings > About, along with the latest commit from GitHub |

Proxy traffic goes over [Wisp](https://github.com/MercuryWorkshop/wisp-protocol). By default that's the public
server `wss://wisp.mercurywork.shop/`; set your own in **Settings > General > Proxy server** for better speed
and reliability. Game feeds load straight from the browser and are cached for six hours. Feeds without CORS
headers (Velara, Truffled) are fetched over the same Wisp connection.

Some sites refuse connections from the public Wisp server's network. Right now that includes Truffled. A Wisp
server you run yourself avoids this, for example `npx @mercuryworkshop/wisp-js` on a home machine or small VPS,
exposed over `wss://`.

### Background effects

Each effect is a JSON file in `public/assets/json/` and is listed in `public/assets/json/particles.json`.
Add a new one by dropping in a file and listing it. Fields: `shape` (`circle`, `line`, `star`, `glow`,
`petal`, `ring`), `density` (particles per pixel), `max`, `colors`, and `[min, max]` ranges for `size`,
`speed`, `opacity`, plus optional `direction` (degrees, 90 = down), `spread`, `sway`, `spin`, `twinkle`,
`wander`, `length` and `fade`.

To update the proxy runtime, bump the versions in `package.json`, run `npm install`, and commit `vendor/`.
Bump `SW_VERSION` in `sw.js` on each release so visitors drop the old cached files.

## Licence

AGPL-3.0-only. If you modify and deploy this for other people to use over a network, review the
source-offer requirements in `LICENSE`.
