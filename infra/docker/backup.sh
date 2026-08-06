#!/usr/bin/env bash
#
# Nightly MongoDB backup for Skills Coach (ADR-0013).
#
# MongoDB is the only copy of everything the product knows — packs, drill items, learner state,
# error logs, audit (ADR-0003). Content authored through the coach API exists nowhere else, because
# this repository is public and holds none of it (ADR-0006). So this dump is not a convenience; it
# is the only path back from a lost volume, and `deploy-ds1` has a button that deletes that volume
# on purpose.
#
#   backup.sh backup            # dump + prune — the nightly action
#   backup.sh verify            # non-zero if the newest snapshot is missing, stale or unreadable
#   backup.sh restore <file>    # mongorestore a snapshot (confirms; DROPS what it restores over)
#
# Runs on the ds1 HOST, where `docker` reaches the daemon — not in the deploy pipeline, which is a
# container holding only the Docker socket and cannot write host paths (ADR-0013). Schedule it from
# the host crontab at 03:00, an hour clear of identity-service's 02:30:
#
#   0 3 * * *  /home/<user>/skills-coach/infra/docker/backup.sh backup >> ~/coach-backup.log 2>&1
#
# Snapshots are PLAINTEXT under a controlled path whose access control is the protection — the same
# scheme identity-service settled on next door. The database password is never handled here:
# mongodump reads the container's own environment, inside the container, so nothing lands in the
# crontab, the log, or this file.
set -euo pipefail

MONGO_CONTAINER="${MONGO_CONTAINER:-skills-coach-mongo-1}"
DB="${MONGO_DB:-skills-coach}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/backup/skills-coach}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-36}"

stamp()  { date -u +%Y%m%d-%H%M%S; }
newest() { ls -1t "$BACKUP_DIR/${DB}-"*.archive.gz 2>/dev/null | head -1 || true; }

case "${1:-}" in
  backup)
    mkdir -p "$BACKUP_DIR"
    out="$BACKUP_DIR/${DB}-$(stamp).archive.gz"
    tmp="$out.partial"

    # Write to .partial and rename only once the archive is whole. A dump that dies halfway
    # otherwise leaves a truncated file that looks exactly like a snapshot — and sorts as the
    # newest one, so it is what you would reach for on the day it matters.
    trap 'rm -f "$tmp"' EXIT
    echo "==> Dumping '$DB' from '$MONGO_CONTAINER' → $out"
    docker exec "$MONGO_CONTAINER" sh -c \
      'exec mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
         --authenticationDatabase admin --db="$1" --archive --gzip' sh "$DB" > "$tmp"
    gzip -t "$tmp"
    mv "$tmp" "$out"
    trap - EXIT
    echo "    wrote $(du -h "$out" | cut -f1)"

    echo "==> Pruning snapshots older than ${RETENTION_DAYS}d in $BACKUP_DIR"
    find "$BACKUP_DIR" -maxdepth 1 -name "${DB}-*.archive.gz" -type f \
      -mtime "+${RETENTION_DAYS}" -print -delete || true
    find "$BACKUP_DIR" -maxdepth 1 -name '*.partial' -type f -mtime +1 -print -delete || true
    echo "    done."
    ;;

  verify)
    # cron failing is silent. This is the thing a check — a scheduled workflow, a monitor, a human
    # on a Monday — can call to find out whether last night actually happened.
    f="$(newest)"
    [ -n "$f" ] || { echo "FAIL: no snapshot in $BACKUP_DIR"; exit 1; }
    gzip -t "$f" 2>/dev/null || { echo "FAIL: newest snapshot is unreadable: $f"; exit 1; }
    age_h=$(( ( $(date -u +%s) - $(stat -c %Y "$f") ) / 3600 ))
    echo "newest: $f (${age_h}h old, $(du -h "$f" | cut -f1))"
    [ "$age_h" -le "$MAX_AGE_HOURS" ] || { echo "FAIL: stale — older than ${MAX_AGE_HOURS}h"; exit 1; }
    echo "OK"
    ;;

  restore)
    file="${2:-}"
    [ -f "$file" ] || { echo "usage: $0 restore <snapshot.archive.gz>"; exit 2; }
    echo "==> Restoring $file into '$MONGO_CONTAINER'"
    echo "    Collections in the snapshot will be DROPPED and replaced. Collections created since"
    echo "    it was taken are left alone — stop the api first if you want the database to match"
    echo "    the snapshot rather than merge with it."
    read -r -p "    Confirm restore? [type 'yes'] " ans
    [ "$ans" = "yes" ] || { echo "    aborted."; exit 1; }
    # No --db: the archive carries its own namespaces, and mongorestore ignores --db for archives.
    docker exec -i "$MONGO_CONTAINER" sh -c \
      'exec mongorestore -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
         --authenticationDatabase admin --archive --gzip --drop' < "$file"
    echo "    restore complete."
    ;;

  *) echo "usage: $0 {backup|verify|restore <file>}"; exit 2 ;;
esac
