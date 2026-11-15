#!/usr/bin/env bash
# Keeps the local Supabase stack's host ports free on a CI runner (tests/config/supabase-ports.test.ts).
#
# Why: the stack binds 54320-54329 (supabase/config.toml), which lie inside Linux's default ephemeral range 32768-60999. Any
# outbound connection on the runner (image pulls, npm) can take one of those ports as its local port for a moment, and
# `supabase start` then fails with "address already in use" (backup self-test run 43619384683).
#
#   supabase-ports.sh wait-free SECONDS wait until no TCP socket, in any state, uses the range; after SECONDS, exit 1, name the
#                                       busy ports and describe each socket that holds one (state, remote end, owner uid, inode)
#
# Moving the ephemeral range above the stack's ports is not done here: it must happen before the job's first network use (checkout,
# npm ci), so each job does it inline as its first step, before this script exists on disk (tests/config/supabase-ports-workflows.test.ts).
#
# SUPABASE_PORT_FIRST / SUPABASE_PORT_LAST override the range (the tests use a single throwaway port); SUPABASE_PROC_NET overrides
# /proc/net (the tests use a missing folder).
set -euo pipefail

FIRST="${SUPABASE_PORT_FIRST:-54320}"
LAST="${SUPABASE_PORT_LAST:-54329}"
PROC_NET="${SUPABASE_PROC_NET:-/proc/net}"

usage() {
  echo "usage: supabase-ports.sh wait-free SECONDS" >&2
  exit 2
}

# The ports in [FIRST, LAST] that a TCP socket (IPv4 or IPv6, listening, connected or in TIME_WAIT) uses as its local port.
# The IPv4 table must be readable: an unreadable one would make every port look free. The IPv6 table may be missing (IPv6 off).
busy_ports() {
  local file files=("$PROC_NET/tcp")
  [ -r "$PROC_NET/tcp6" ] && files+=("$PROC_NET/tcp6")
  for file in "${files[@]}"; do
    # Column 2 is local_address as HEXADDR:HEXPORT.
    awk 'NR > 1 { split($2, a, ":"); print a[length(a)] }' "$file"
  done | while read -r hex; do
    port=$((16#$hex))
    if [ "$port" -ge "$FIRST" ] && [ "$port" -le "$LAST" ]; then echo "$port"; fi
  done | sort -un | tr '\n' ' ' | sed 's/ $//'
}

# TCP states as /proc/net/tcp numbers them (include/net/tcp_states.h).
state_name() {
  case "$1" in
    01) echo ESTABLISHED ;; 02) echo SYN_SENT ;; 03) echo SYN_RECV ;; 04) echo FIN_WAIT1 ;; 05) echo FIN_WAIT2 ;;
    06) echo TIME_WAIT ;; 07) echo CLOSE ;; 08) echo CLOSE_WAIT ;; 09) echo LAST_ACK ;; 0A) echo LISTEN ;; 0B) echo CLOSING ;;
    *) echo "state-$1" ;;
  esac
}

# An IPv4 address as /proc/net/tcp writes it (8 hex digits, little-endian) in dotted form; an IPv6 one is left in hex.
ipv4_of() {
  local h="$1"
  if [ "${#h}" -ne 8 ]; then echo "$h"; return; fi
  echo "$((16#${h:6:2})).$((16#${h:4:2})).$((16#${h:2:2})).$((16#${h:0:2}))"
}

# One line per socket whose local port is in [FIRST, LAST]: port, state, remote end, owner uid and inode, and which table it is in.
describe_busy() {
  local file name local_addr remote_addr st uid inode lport
  echo "supabase-ports: the sockets that hold them:"
  for name in tcp tcp6; do
    file="$PROC_NET/$name"
    [ -r "$file" ] || continue
    # Columns: sl local_address rem_address st tx_queue:rx_queue tr:tm->when retrnsmt uid timeout inode.
    awk 'NR > 1 { print $2, $3, $4, $8, $10 }' "$file" | while read -r local_addr remote_addr st uid inode; do
      lport=$((16#${local_addr##*:}))
      if [ "$lport" -ge "$FIRST" ] && [ "$lport" -le "$LAST" ]; then
        echo "  port $lport: $(state_name "$st"), local $(ipv4_of "${local_addr%:*}"), remote $(ipv4_of "${remote_addr%:*}"):$((16#${remote_addr##*:})), uid $uid, inode $inode ($name)"
      fi
    done
  done
}

case "${1:-}" in
  wait-free)
    [ "$#" -eq 2 ] || usage
    [[ "$2" =~ ^[0-9]+$ ]] || usage
    if [ ! -r "$PROC_NET/tcp" ]; then
      echo "supabase-ports: cannot read $PROC_NET/tcp, so the ports cannot be checked" >&2
      exit 1
    fi
    # 10#: a leading zero is decimal, not octal ("08" would be an arithmetic error).
    deadline=$((SECONDS + 10#$2))
    while :; do
      busy="$(busy_ports)"
      [ -z "$busy" ] && exit 0
      if [ "$SECONDS" -ge "$deadline" ]; then
        echo "supabase-ports: ports still in use after ${2}s: $busy" >&2
        # Which sockets hold them, always (the kernel's own tables, no tool needed), so the failure says what to fix; ss adds the process when present.
        describe_busy >&2
        if command -v ss >/dev/null; then
          echo "ss -tanp:" >&2
          { sudo -n ss -tanp 2>/dev/null || ss -tanp 2>/dev/null || ss -tan; } >&2 || true
        fi
        exit 1
      fi
      sleep 1
    done
    ;;
  *)
    usage
    ;;
esac
