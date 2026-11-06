# Moving chaseteichmann.com to Cloudflare

The site moves from GitHub Pages to a Cloudflare Worker that only serves static files (`wrangler.toml`), and DNS moves from AWS Route 53 to Cloudflare. That lets this repo go private without paying for GitHub Pro.

**Cost: $0 a month**, and about $0.50 a month less once the Route 53 zone is deleted. Everything here is on free plans: the Cloudflare Free zone, Universal SSL, the Workers Free plan (static file requests are free and unlimited), Workers Builds (3,000 build minutes a month on Free), Worker custom domains and Redirect Rules (10 on Free). If a screen offers an upgrade, a paid add-on (Argo, APO, Load Balancing, Workers Paid) or asks for a card, skip it: nothing below needs one. The domain stays registered at Squarespace and renews there as it does today.

**FishLog stays up the whole time.** Its two records are copied exactly and are never proxied, so its traffic and HTTPS certificate keep going straight to AWS.

## DNS records

These are the Route 53 records today (zone `Z04338202J25JULOHTZFV`). Cloudflare must end up with the ones marked keep, all set to **DNS only** (grey cloud).

| Name | Type | Value | Plan |
|---|---|---|---|
| `chaseteichmann.com` | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` | GitHub Pages. Keep (DNS only) until step 6, then the Worker custom domain replaces it |
| `chaseteichmann.com` | AAAA | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` | Same as the A records |
| `www` | CNAME | `chase-teichmann.github.io` | Same as the A records |
| FishLog's subdomain | CNAME | `d1qv3dxqb9he73.cloudfront.net` | **Keep, DNS only, forever.** FishLog |
| `_944239638e3e43bd741c64d42fdd8f75` | CNAME | `_107b6573ed3035bdb058e5534380948f.jkddzztszm.acm-validations.aws.` | **Keep, DNS only, forever.** FishLog's certificate renewal (current certificate expires 2027-03-10; AWS renews it from about January 2027 and needs this record then) |
| `_github-pages-challenge-chase-teichmann` | TXT | `5717f3b1c1d988e5a8332bc5de1e70` | Delete in step 11 |

There are no MX records, so email isn't affected. DNSSEC is off for the domain (`whois` shows `unsigned`), so the nameserver switch needs no DS-record step.

## Checklist

Do these in order. Nothing in steps 1 to 4 changes what visitors see.

1. **Merge the PR that adds `wrangler.toml`.**
2. **Add the zone.** Cloudflare dashboard (the account that already runs `chaseteichmann-booking`) → *Add a domain* → `chaseteichmann.com` → **Free** plan. Turn off *Proxy imported records* / any "proxy by default" option if offered.
3. **Check the imported records against the table above.** The quick scan guesses common names, so it often misses the `_944239…` ACM record and can miss FishLog's record: add any missing ones by hand, with the exact names and values above. Then:
   - Set **every** record to **DNS only** (grey cloud), including the apex and `www` for now. The site keeps being served by GitHub Pages until step 6.
   - Make sure FishLog's CNAME and the ACM `_944239…` CNAME are grey. If either is proxied (orange), FishLog's traffic would go through Cloudflare and the ACM record would be hidden by CNAME flattening, so the certificate renewal would fail.
   - Don't add any CAA records (AWS's certificate authority would then need its own entry).
   - Note the two nameservers Cloudflare assigns (`<name>.ns.cloudflare.com`).
4. **Connect Workers Builds for the site.** *Workers & Pages* → *Create* → *Import a repository* → `chase-teichmann/chaseteichmann-portfolio`.
   - Worker name: `chaseteichmann-site` (it must match `name` in `wrangler.toml`, or builds fail)
   - Production branch: `main`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch deploy command: leave the default, `npx wrangler versions upload`
   - Root directory: `/`
   - Build watch paths (optional, saves build minutes): include `*`, exclude `booking/*`
   - Build variable: `NODE_VERSION` = `22`

   Let the first build finish, then open the Worker's `*.workers.dev` URL and check the home page, a project page and `/privacy/`. (Booking won't work on the `workers.dev` address because the booking Worker only accepts the real domain. That's expected.)
5. **Switch the nameservers at Squarespace** (the registrar, not AWS): Squarespace → *Domains* → `chaseteichmann.com` → *DNS* → *Domain nameservers* → *Use custom nameservers* → enter the two Cloudflare nameservers from step 3, replacing the four `awsdns` ones. Leave the Route 53 zone alone: resolvers that still have the old nameservers cached (up to 48 hours) keep using it, and it gives the same answers, so nothing goes down.
6. **When Cloudflare says the zone is Active** (it emails you), add the Worker's custom domains: *Workers & Pages* → `chaseteichmann-site` → *Settings* → *Domains & Routes* → *Add* → *Custom domain* → `chaseteichmann.com`, then again for `www.chaseteichmann.com`. If it says a DNS record already exists, delete only the GitHub Pages records (the apex A and AAAA, and the `www` CNAME) under *DNS* → *Records* and add the custom domain again; the site is unreachable for the minute in between, for visitors already on Cloudflare. Never touch FishLog's two records.
7. **Redirect www to the apex.** *Rules* → *Redirect Rules* → *Create rule* (or the *Redirect from WWW to root* template):
   - When incoming requests match: *Hostname* equals `www.chaseteichmann.com`
   - Then: *Dynamic*, expression `concat("https://chaseteichmann.com", http.request.uri.path)`, status **301**, *Preserve query string* on

   And under *SSL/TLS* → *Edge Certificates*, turn on **Always Use HTTPS** (this makes `http://` 301 to `https://`).
8. **Turn off features that add scripts or cookies** (the site sets no cookies and loads no third-party scripts):
   - *Scrape Shield* → **Email Address Obfuscation: Off** (it's on by default and injects a script)
   - *Speed* → *Optimization* → **Rocket Loader: Off**
   - *Analytics & Logs* → *Web Analytics*: don't enable it for this site, and leave automatic setup off (it injects a beacon)
   - *Security* → *Bots*: **Bot Fight Mode: Off** (its challenges set cookies)
   - Don't add Turnstile or Zaraz.
9. **Verify** once `dig NS chaseteichmann.com @1.1.1.1` and `@8.8.8.8` both show Cloudflare: run `scripts/verify-cloudflare.sh` with `FISH_HOST` set to FishLog's hostname. Every line should say `ok`. Run it again the next day, and check in the AWS console (*Certificate Manager*, us-east-1) that FishLog's certificate still shows *Issued*.
10. **Merge the follow-up PR** that removes `.github/workflows/pages.yml`, `public/CNAME` and the CI check for it.
11. **Clean up**, at least 48 hours after step 5 so every cached nameserver has expired:
    - Cloudflare *DNS*: delete the `_github-pages-challenge-chase-teichmann` TXT record.
    - Route 53: delete the hosted zone `Z04338202J25JULOHTZFV` (delete its records except NS and SOA first; AWS requires it). This saves about $0.50 a month. Before deleting, confirm `whois chaseteichmann.com` lists only Cloudflare nameservers.
12. **Make the repo private:** GitHub → repo *Settings* → *General* → *Danger Zone* → *Change visibility* → *Private*. Then *Settings* → *Pages*: make sure the site is unpublished and remove the custom domain. Workers Builds keeps working on a private repo as long as the Cloudflare GitHub app has access to it (check under GitHub *Settings* → *Applications* → *Cloudflare Workers and Pages*). GitHub Actions on a private repo uses the free 2,000 minutes a month; the PR checks use a few minutes each.

## If something goes wrong

- **Site down after step 6:** delete the Worker custom domains and re-add the GitHub Pages records from the table (DNS only). GitHub Pages still serves the site until step 12.
- **FishLog down at any point:** check its CNAME and the ACM record in Cloudflare *DNS* match the table and are grey. Before step 11, switching the nameservers back to the four `awsdns` ones at Squarespace restores the old setup completely.
