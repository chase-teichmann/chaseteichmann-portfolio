# chaseteichmann.com

Chase Teichmann's portfolio, built as a small storefront: projects are products, and checkout books a free 30-minute intro call.

| Folder | What it is | How it ships |
|---|---|---|
| `site/` | The website (static HTML) | GitHub Pages, via `.github/workflows/pages.yml` on every push to `main` that touches `site/` |
| `booking/` | The booking service (Cloudflare Worker) | Cloudflare Workers Builds, on every push to `main` that touches `booking/` |

See [`booking/README.md`](booking/README.md) for how booking works and how to set it up again.

A componentized Astro rebuild will replace `site/`.
