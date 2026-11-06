# Booking service

A small Cloudflare Worker that lets visitors book a 30-minute intro call from the site's checkout.

- `GET /availability?minutes=30` returns open slot start times: Chase's hours, minus anything already on his Google Calendar.
- `POST /book` re-checks the slot, then creates the event with a Google Meet link. Google emails the invite to the visitor.

The Worker reads free/busy only, never event details. It answers only requests from `ALLOWED_ORIGINS` in `wrangler.toml`. If a calendar can't be read, it offers no times rather than risk a double booking.

Hours, notice and horizon live in `src/rules.js`.

## How it's wired

| Piece | Where |
|---|---|
| Code | this folder, in `chase-teichmann/chaseteichmann-portfolio` |
| Deploys | Cloudflare **Workers Builds**, connected to this repo. Root directory `booking`, deploy command `npx wrangler deploy`. Every push to `main` that touches `booking/` redeploys. |
| Secrets | Cloudflare dashboard → Workers & Pages → `chaseteichmann-booking` → Settings → Variables and Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. A deploy never overwrites them. |
| Google access | Google Cloud project `chaseteichmann-booking`: Calendar API enabled, consent screen **In production**, and a Web OAuth client whose redirect URI is `https://developers.google.com/oauthplayground` |
| Site hook | `data-booking-endpoint` on the checkout form, set from `bookingEndpoint` in `src/data/site.json` (the Worker URL). If it's empty, checkout runs in preview mode. |

## Getting a new refresh token

You need a new token if Google revokes the old one. In the logs, that shows up as `invalid_grant`.

1. Open <https://developers.google.com/oauthplayground>, then the gear icon. Tick **Use your own OAuth credentials** and paste the client ID and secret.
2. In **Input your own scopes**, enter:
   `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy`
3. Select **Authorize APIs**. Sign in with the Gmail account whose calendar takes bookings, then allow both permissions. On the "unverified app" warning, choose Advanced, then Go to the app.
4. Select **Exchange authorization code for tokens**. Copy the refresh token into the `GOOGLE_REFRESH_TOKEN` secret in Cloudflare.

`npm run token` (`scripts/token.mjs`) does the same from a terminal. It needs a **Desktop app** OAuth client instead.

## Changing things later

- **Hours:** edit `src/rules.js` and push. If the site shows hours, update the site too.
- **Allowed sites:** edit `ALLOWED_ORIGINS` in `wrangler.toml` and push.
- **Work calendar:** have it share free/busy with the Gmail account. Then set `BUSY_CALENDAR_IDS = "primary,you@work.com"` in `wrangler.toml` and push.
- **Logs:** Cloudflare dashboard → the Worker → Logs. From a terminal, `npx wrangler tail`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Checkout can't load open times (503) | Check the logs. `invalid_grant` means the refresh token was revoked, or the consent screen was left in Testing. Get a new token (above). |
| Times load, but booking fails | The token is missing `calendar.events`. Get a new token and allow both permissions. |
| The browser console shows a CORS error | The page's address isn't in `ALLOWED_ORIGINS`. |
| A visitor didn't get the invite | Check the event for their address. The invite comes from the Gmail account, so it can land in spam. |

## Develop

```sh
npm ci
npx vitest run                    # 14 tests: slot rules and the Worker's endpoints
cp .dev.vars.example .dev.vars    # fill in the three values, never commit this file
npx wrangler dev                  # http://localhost:8787
```
