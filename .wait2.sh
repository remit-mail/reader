#!/usr/bin/env bash
PRS="$*"
for i in $(seq 1 60); do
  pending=0; out=""
  for n in $PRS; do
    c=$(gh pr view "$n" --json statusCheckRollup -q '.statusCheckRollup|map(select(.name=="gate"))|.[0]|.conclusion // "PENDING"' 2>/dev/null)
    { [ "$c" = "PENDING" ] || [ -z "$c" ]; } && pending=$((pending+1))
    out="$out$n=$c "
  done
  echo "[$i] $out"
  [ "$pending" -eq 0 ] && echo "ALL TERMINAL" && exit 0
  sleep 45
done
echo "TIMED OUT"
