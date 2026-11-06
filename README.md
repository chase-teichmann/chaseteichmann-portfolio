# chaseteichmann.com

Chase Teichmann's portfolio, built as a small storefront: projects are products, and checkout books a free 30-minute intro call.

| Folder | What it is | How it ships |
|---|---|---|
| `src/`, `public/` | The website (Astro, built to static HTML in `dist/`) | GitHub Pages, via `.github/workflows/pages.yml` on every push to `main` that touches the site |
| `booking/` | The booking service (Cloudflare Worker) | Cloudflare Workers Builds, on every push to `main` that touches `booking/` |

See [`booking/README.md`](booking/README.md) for how booking works and how to set it up again.

## Run the site locally

Needs Node 22.

```sh
npm ci
npm run dev       # http://localhost:4321
npm run build     # writes dist/
npm run preview   # serves dist/
```

## Where things live

- **Content** is data, not markup: `src/data/`.
  - `projects/NN-slug.json`: one file per project (the `NN` prefix sets the store order). Card, product view, project page, cart and stack lists all read from here.
  - `art/`: each project's cover drawing (SVG) and its map or "how it works" figure.
  - `site.json` (name, links, booking endpoint), `home.json`, `hero.json`, `experience.json`, `stack.json`, `stack-lab.json`, `store.json`, `checkout.json`, `privacy.json`.
- **Components**: `src/components/`.
  - `layout/`: header, footer, theme toggle, the Retro theme's window chrome.
  - `home/`: hero, project card, product view (study), work, experience and stack sections.
  - `project/`: project page sections (gallery, buy box, prose sections, related projects, webring).
  - `cart/`: cart button, cart drawer, checkout and confirmation.
  - `PrivacySection.astro`: the privacy page.
- **Styles and scripts** are inlined into each page, unchanged: `src/styles/`, `src/scripts/`, wired up in `src/lib/assets.ts`.

The site sets no cookies and loads no third-party scripts. The theme choice (Modern or Retro) is kept in the visitor's browser under the `ct-theme` localStorage key.
