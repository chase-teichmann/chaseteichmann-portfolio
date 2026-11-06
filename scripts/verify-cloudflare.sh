#!/usr/bin/env bash
# Checks chaseteichmann.com after its DNS moved to Cloudflare. Read-only: it only runs dig, curl and
# openssl. See docs/cloudflare-move.md.
#
#   scripts/verify-cloudflare.sh
#   FISH_HOST=<FishLog hostname> scripts/verify-cloudflare.sh   # also check FishLog
#
# FishLog's hostname is passed in, not written here: the subdomain never appears in this repo's site.
# Exits non-zero if any check fails.

set -u
APEX=chaseteichmann.com
SITE="https://$APEX"
BOOKING=https://chaseteichmann-booking.chaseteichmann-business.workers.dev
ACM_NAME=_944239638e3e43bd741c64d42fdd8f75.$APEX
ACM_TARGET=_107b6573ed3035bdb058e5534380948f.jkddzztszm.acm-validations.aws.
FISH_HOST=${FISH_HOST:-}
FISH_TARGET=d1qv3dxqb9he73.cloudfront.net.

fails=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$2', want '$3')"; fi; }

# status and Location of one request, no redirects followed
head_of() { curl -s -o /dev/null --max-time 15 -w '%{http_code} %{redirect_url}' "$1"; }

echo "Nameservers"
for resolver in 1.1.1.1 8.8.8.8; do
  ns=$(dig +short NS "$APEX" @"$resolver" | sort | tr '\n' ' ')
  case "$ns" in
    *awsdns*|'') fail "NS via $resolver: ${ns:-none}" ;;
    *.ns.cloudflare.com.*) pass "NS via $resolver: $ns" ;;
    *) fail "NS via $resolver: $ns" ;;
  esac
done

echo "Site"
check "$SITE/ returns 200" "$(head_of "$SITE/")" "200 "
check "http://$APEX/ 301s to $SITE/" "$(head_of "http://$APEX/")" "301 $SITE/"
check "http://www.$APEX/ 301s to $SITE/" "$(head_of "http://www.$APEX/")" "301 $SITE/"
check "https://www.$APEX/ 301s to $SITE/" "$(head_of "https://www.$APEX/")" "301 $SITE/"
check "https://www.$APEX/privacy/ keeps its path" "$(head_of "https://www.$APEX/privacy/")" "301 $SITE/privacy/"
for path in /og.png /sw.js /sitemap.xml /robots.txt /privacy/ /work/returns-platform/ "/?theme=retro"; do
  check "$path returns 200" "$(head_of "$SITE$path")" "200 "
done
check "/og.png is a PNG" "$(curl -s --max-time 15 -o /dev/null -w '%{content_type}' "$SITE/og.png")" "image/png"
curl -s --max-time 15 "$SITE/sitemap.xml" | grep -q '<urlset' && pass "/sitemap.xml is a sitemap" || fail "/sitemap.xml has no <urlset>"

headers=$(curl -s -D - -o /dev/null --max-time 15 "$SITE/")
echo "$headers" | grep -qi '^server: cloudflare' && pass "served by Cloudflare" || fail "not served by Cloudflare (still GitHub Pages?)"
echo "$headers" | grep -qi '^set-cookie' && fail "home page sets a cookie" || pass "no cookies set"
html=$(curl -s --max-time 15 "$SITE/")
if echo "$html" | grep -Eq 'cdn-cgi/scripts|email-decode|rocket-loader|beacon\.min\.js|challenge-platform|zaraz'; then
  fail "Cloudflare injected a script into the home page (email obfuscation, Rocket Loader, analytics or a challenge)"
else
  pass "no Cloudflare-injected scripts"
fi

echo "FishLog"
check "ACM validation CNAME" "$(dig +short CNAME "$ACM_NAME" @1.1.1.1)" "$ACM_TARGET"
if [ -z "$FISH_HOST" ]; then
  echo "  skip  set FISH_HOST to check FishLog itself"
else
  check "$FISH_HOST CNAME (DNS only)" "$(dig +short CNAME "$FISH_HOST" @1.1.1.1)" "$FISH_TARGET"
  code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "https://$FISH_HOST/")
  case "$code" in
    2??|3??) pass "https://$FISH_HOST/ returns $code with a valid certificate" ;;
    *) fail "https://$FISH_HOST/ returned $code (000 means TLS or connection failure)" ;;
  esac
  expiry=$(echo | openssl s_client -connect "$FISH_HOST:443" -servername "$FISH_HOST" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' ')
  [ -n "$expiry" ] && pass "certificate: $expiry" || fail "could not read $FISH_HOST certificate"
fi

echo "Booking (CORS from the site)"
check "preflight from $SITE" "$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' -X OPTIONS -H "Origin: $SITE" -H 'Access-Control-Request-Method: POST' "$BOOKING/book")" "204"
acao=$(curl -s -D - -o /dev/null --max-time 20 -H "Origin: $SITE" "$BOOKING/availability" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')
check "/availability allows $SITE" "$acao" "$SITE"

echo
if [ "$fails" -eq 0 ]; then echo "All checks passed."; else echo "$fails check(s) failed."; fi
exit $((fails > 0))
