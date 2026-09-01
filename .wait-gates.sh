#!/usr/bin/env bash
PRS="1080 1079 1078 1077 1027 1026 1025 1000"
for i in $(seq 1 90); do
  pending=0; out=""
  for n in $PRS; do
    c=$(gh pr view "$n" --json statusCheckRollup -q '.statusCheckRollup|map(select(.name=="gate"))|.[0]|.conclusion // "PENDING"' 2>/dev/null)
    [ "$c" = "PENDING" ] || [ -z "$c" ] && pending=$((pending+1))
    out="$out$n=$c "
  done
  echo "[$i] $out"
  [ "$pending" -eq 0 ] && echo "ALL TERMINAL" && exit 0
  sleep 40
done
echo "TIMED OUT"
