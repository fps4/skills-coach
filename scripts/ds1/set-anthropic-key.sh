#!/usr/bin/env bash
# Put the word worker's Anthropic API key on ds1 (ADR-0034).
#
#   scripts/ds1/set-anthropic-key.sh              # reads the key from the macOS clipboard
#   scripts/ds1/set-anthropic-key.sh < key.txt    # or from stdin
#
# The key goes over SSH into a mode-600 file in a mode-700 directory on ds1, which the worker
# container mounts read-only and re-reads every cycle: no redeploy, no restart. It is never printed,
# never passed as an argument (so it is not in `ps` or shell history), and never committed. The same
# command rotates it. Set DS1_HOST to use another SSH alias; ds1.remote works off the home network.
set -euo pipefail

HOST="${DS1_HOST:-ds1.remote}"
CONTAINER=skills-coach-word-worker

if [ -t 0 ]; then
  command -v pbpaste >/dev/null || { echo "no clipboard (pbpaste); pipe the key on stdin instead" >&2; exit 1; }
  key="$(pbpaste)"
  from=clipboard
else
  key="$(cat)"
  from=stdin
fi
key="$(printf '%s' "$key" | tr -d '[:space:]')"

case "$key" in
  sk-ant-*) ;;
  *) echo "the $from does not hold an Anthropic API key (expected one starting sk-ant-); nothing sent" >&2; exit 1 ;;
esac

# Written to a temporary name and renamed, so the worker never reads half a key. The directory
# path must match WORD_WORKER_SECRETS_DIR in config/ds1/.env.base.
# Prints ds1's clock when the key landed, so the check below reads only what the worker logged after.
written_at="$(printf '%s' "$key" | ssh "$HOST" '
  set -e
  umask 077
  dir="$HOME/.config/skills-coach-word-worker"
  mkdir -p "$dir"
  chmod 700 "$dir"
  cat > "$dir/anthropic-api-key.tmp"
  mv "$dir/anthropic-api-key.tmp" "$dir/anthropic-api-key"
  date +%s
')"
unset key
echo "key written to $HOST:~/.config/skills-coach-word-worker/anthropic-api-key (${from})"

if [ "$from" = clipboard ]; then
  printf '' | pbcopy
  echo "clipboard cleared"
fi

# The worker re-reads the key every cycle (every 30 seconds while it has none) and logs when it loads
# a new one. $CONTAINER and $written_at expand here, on purpose.
# shellcheck disable=SC2029
if ssh "$HOST" "docker inspect $CONTAINER >/dev/null 2>&1"; then
  echo "waiting for the worker to pick it up…"
  for _ in $(seq 1 14); do
    # shellcheck disable=SC2029
    if ssh "$HOST" "docker logs --since $written_at $CONTAINER 2>&1 | grep -q 'Anthropic key loaded'"; then
      echo "the worker has the key"
      exit 0
    fi
    sleep 5
  done
  echo "the worker has not reported the key yet — check: ssh $HOST docker logs --tail 20 $CONTAINER" >&2
  exit 1
else
  echo "the worker is not deployed yet; it will read the key when it starts"
fi
