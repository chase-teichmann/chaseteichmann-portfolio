# Booking service

A small Cloudflare Worker that lets visitors book a 30-minute intro call from the site's checkout.

- `GET /availability?minutes=30` returns open slot start times: Chase's hours, minus anything already on his Google Calendar.
- `POST /book` re-checks the slot, then creates the event with a Google Meet link. Google emails the invite to the visitor.

The Worker reads free/busy, plus the events it created itself (to limit repeat bookings), never your other events' details. It answers only requests from `ALLOWED_ORIGINS` in `wrangler.toml`. If a calendar can't be read, it offers no times rather than risk a double booking.

Hours, notice and horizon live in `src/rules.js`.

## How it's wired

| Piece | Where |
|---|---|
| Code | this folder, in `chase-teichmann/chaseteichmann-portfolio` |
| Deploys | Cloudflare **Workers Builds**, connected to this repo. Root directory `booking`, deploy command `npx wrangler deploy`. Every push to `main` that touches `booking/` redeploys. |
| Secrets | Cloudflare dashboard → Workers & Pages → `chaseteichmann-booking` → Settings → **Runtime variables and secrets (Production)**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Not Build variables. A deploy never overwrites them. |
| Google access | Google Cloud project `chaseteichmann-booking`: Calendar API enabled, consent screen **In production**, and a Web OAuth client whose redirect URI is `https://developers.google.com/oauthplayground` |
| Site hook | `data-booking-endpoint` on the checkout form, set from `bookingEndpoint` in `src/data/site.json` (the Worker URL). If it's empty, checkout runs in preview mode. |

## Limits against abuse

The `Origin` check stops other websites, but not scripts, so the Worker also:

- rate-limits each IP address (`AVAILABILITY_LIMIT` 30 a minute, `BOOK_LIMIT` 3 a minute, in `wrangler.toml`),
- rejects requests that fill the hidden `website` field,
- allows one upcoming call per email address, and
- stops taking bookings when `MAX_UPCOMING_BOOKINGS` (10) site calls are already on the calendar.

It recognises its own events by a private tag (`source=chaseteichmann.com`) on each one.

## Booking notifications

When `NOTIFY_EMAIL` is set, each new booking also sends you an email from your own Gmail with the time and a link to the event. The visitor's details stay on the calendar event, as the privacy page says.

To turn it on (once):

1. In Google Cloud → **APIs & Services → Library**, enable the **Gmail API**. Without it, sending fails with a 403 even when the token has the scope.
2. In Google Cloud → **Google Auth Platform → Data access**, add the scope `https://www.googleapis.com/auth/gmail.send`. Google has no narrower "send only to myself" scope; `gmail.send` is the smallest one that can send mail.
3. Get a new refresh token (below) with all three scopes, and replace `GOOGLE_REFRESH_TOKEN` in Cloudflare.
4. In Cloudflare → the Worker → **Settings → Runtime variables and secrets (Production)**, add `NOTIFY_EMAIL` as a **secret** (a plain variable would be erased by the next deploy) set to the address that should get the emails (usually the same Gmail).

Until then bookings work as before, without the email. If sending fails, the booking still goes through and the error shows in the logs.

## Health check

`.github/workflows/booking-health.yml` asks the Worker for open times every 6 hours. If that fails, it opens a `booking-down` issue assigned to you, so GitHub emails you. It closes the issue when booking works again. Run it by hand from the repo's Actions tab.

## Getting a new refresh token

You need a new token if Google revokes the old one. In the logs, that shows up as `invalid_grant`.

1. Open <https://developers.google.com/oauthplayground>, then the gear icon. Tick **Use your own OAuth credentials** and paste the client ID and secret.
2. In **Input your own scopes**, enter:
   `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/gmail.send`
   (Leave out `gmail.send` if you don't want booking emails.)
3. Select **Authorize APIs**. Sign in with the Gmail account whose calendar takes bookings, then allow every permission. On the "unverified app" warning, choose Advanced, then Go to the app.
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
| Times load, but booking fails | The token is missing `calendar.events`. Get a new token and allow every permission. |
| Bookings work but no email arrives | `NOTIFY_EMAIL` isn't set as a secret, the Gmail API isn't enabled, or the token lacks `gmail.send` (the logs show `notify failed: Gmail send → 403`). |
| A visitor sees "You already have a call booked" | They have an upcoming call already. They can change it from their calendar invite. |
| The browser console shows a CORS error | The page's address isn't in `ALLOWED_ORIGINS`. |
| A visitor didn't get the invite | Check the event for their address. The invite comes from the Gmail account, so it can land in spam. |

## Develop

```sh
npm ci
npx vitest run                    # 20 tests: slot rules, the Worker's endpoints and its limits
cp .dev.vars.example .dev.vars    # fill in the three values, never commit this file
npx wrangler dev                  # http://localhost:8787
```
