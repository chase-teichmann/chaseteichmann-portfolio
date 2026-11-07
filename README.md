# chaseteichmann.com

Chase Teichmann's portfolio, built as a small storefront: projects are products, and checkout books a free 30-minute intro call.

| Folder | What it is | How it ships |
|---|---|---|
| `src/`, `public/` | The website (Astro, built to static HTML in `dist/`) | Cloudflare Workers Builds, as the static-files-only Worker `chaseteichmann-site` (`wrangler.toml`), on every push to `main`. Until the move in [`docs/cloudflare-move.md`](docs/cloudflare-move.md) is finished, GitHub Pages (`.github/workflows/pages.yml`) also still deploys it |
| `booking/` | The booking service (Cloudflare Worker) | Cloudflare Workers Builds, on every push to `main` that touches `booking/` |

See [`booking/README.md`](booking/README.md) for how booking works and how to set it up again.

## Run the site locally

Needs Node 22.

```sh
npm ci
npm run dev       # http://localhost:4321
npm run build     # writes dist/
npm run preview   # serves dist/
npx wrangler dev  # serves dist/ the way Cloudflare does (run npm run build first)
```

After a DNS change, `scripts/verify-cloudflare.sh` checks the live domain, redirects, static files, FishLog's records and booking CORS.

## Checks

Every pull request runs `.github/workflows/ci.yml`: the site must build, its Worker config must pass a `wrangler deploy --dry-run`, and the booking Worker's tests must pass. Dependabot (`.github/dependabot.yml`) opens weekly update PRs.

## Where things live

- **Content** is data, not markup: `src/data/`.
  - `projects/NN-slug.json`: one file per project (the `NN` prefix sets the store order). Card, product view, project page, cart and stack lists all read from here.
  - `art/`: each project's cover drawing (SVG) and its map or "how it works" figure.
  - `site.json` (name, links, booking endpoint, and `careerStart`, the date "Years in production" counts from; the browser works the number out, so it never needs a yearly edit), `home.json`, `hero.json`, `experience.json`, `stack.json`, `stack-lab.json`, `store.json`, `checkout.json`, `privacy.json`.
- **Components**: `src/components/`.
  - `layout/`: header, footer, theme toggle, the Retro theme's window chrome.
  - `home/`: hero, project card, product view (study), work, experience and stack sections.
  - `project/`: project page sections (gallery, buy box, prose sections, related projects, webring).
  - `cart/`: cart button, cart drawer, checkout and confirmation.
  - `booking/`: the "Your booking" page.
  - `PrivacySection.astro`: the privacy page.
- **Static files** in `public/`: `CNAME`, `robots.txt`, `og.png` (the link-preview image; its source and render script are in `scripts/og/`), and `sw.js`, which removes the old site's leftover service worker from returning visitors' browsers.
- **Styles and scripts** are inlined into each page, unchanged: `src/styles/`, `src/scripts/`, wired up in `src/lib/assets.ts`.

The site sets no cookies and loads no third-party scripts. The theme choice (Modern or Retro) is kept in the visitor's browser under the `ct-theme` localStorage key.

After a real booking, checkout saves it under the `ct-booking` localStorage key and sends the visitor to `/booking/` ("Your booking", `src/pages/booking/`, `src/components/booking/`, `src/scripts/booking.js`). While a booking is saved, a "Your booking" button shows in the header on every page. The booking clears itself when the call ends, or when the visitor removes it. `/booking/` is not in the sitemap and is marked `noindex`.
