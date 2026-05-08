#!/usr/bin/env bash
set -euo pipefail

mkdir -p /var/log/tor /run/tor

# Tor foreground; nginx stays in foreground via CMD chaining from this script.
tor -f /etc/tor/torrc &
TOR_PID="$!"

# Wait until Tor has opened its SOCKS/control paths enough to serve HS (best-effort).
for _ in $(seq 1 60); do
  if [ -f /var/lib/tor/silkgenesis_service/hostname ] || kill -0 "$TOR_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

exec nginx -g "daemon off;"
