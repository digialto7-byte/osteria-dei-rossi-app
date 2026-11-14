#!/usr/bin/env bash
# Keeps the local Supabase stack's host ports free on a CI runner (tests/config/supabase-ports.test.ts).
#
# Why: the stack binds 54320-54329 (supabase/config.toml), which lie inside Linux's default ephemeral range 32768-60999. Any
# outbound connection on the runner (image pulls, npm) can take one of those ports as its local port for a moment, and
# `supabase start` then fails with "address already in use" (backup self-test run 43619384683).
#
#   supabase-ports.sh reserve           move the ephemeral range to 55000-60999, above the stack's ports (needs sudo)
#   supabase-ports.sh wait-free SECONDS wait until no TCP socket, in any state, uses the range; after SECONDS, exit 1 and
#                                       name the busy ports
#
# SUPABASE_PORT_FIRST / SUPABASE_PORT_LAST override the range (the tests use a single throwaway port).
set -euo pipefail

FIRST="${SUPABASE_PORT_FIRST:-54320}"
LAST="${SUPABASE_PORT_LAST:-54329}"

usage() {
  echo "usage: supabase-ports.sh reserve | wait-free SECONDS" >&2
  exit 2
}

# The ports in [FIRST, LAST] that a TCP socket (IPv4 or IPv6, listening, connected or in TIME_WAIT) uses as its local port.
busy_ports() {
  local file
  for file in /proc/net/tcp /proc/net/tcp6; do
    [ -r "$file" ] || continue
    # Column 2 is local_address as HEXADDR:HEXPORT.
    awk 'NR > 1 { split($2, a, ":"); print a[length(a)] }' "$file"
  done | while read -r hex; do
    port=$((16#$hex))
    if [ "$port" -ge "$FIRST" ] && [ "$port" -le "$LAST" ]; then echo "$port"; fi
  done | sort -un | tr '\n' ' ' | sed 's/ $//'
}

case "${1:-}" in
  reserve)
    [ "$#" -eq 1 ] || usage
    sudo sysctl -w net.ipv4.ip_local_port_range="55000 60999"
    ;;
  wait-free)
    [ "$#" -eq 2 ] || usage
    [[ "$2" =~ ^[0-9]+$ ]] || usage
    deadline=$((SECONDS + $2))
    while :; do
      busy="$(busy_ports)"
      [ -z "$busy" ] && exit 0
      if [ "$SECONDS" -ge "$deadline" ]; then
        echo "supabase-ports: ports still in use after ${2}s: $busy" >&2
        exit 1
      fi
      sleep 1
    done
    ;;
  *)
    usage
    ;;
esac
