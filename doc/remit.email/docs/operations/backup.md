---
title: Backup
description: One SQLite file and one key. Everything else re-syncs.
---

# Backup

Two files are worth protecting:

1. `remit.db`: accounts, identities, settings, rules, the message index, the outbox, labels and quarantined mail. An install that moved the app or mail database to a file of its own (`SQLITE_APP_DB_PATH`, `SQLITE_MAIL_DB_PATH`) protects each of those files.
2. `.env`, for `FAKE_KMS_DATAKEY`: the key that decrypts every stored mailbox credential. No other copy exists, and no database backup replaces it.

Backups skip message bodies on purpose. Bodies are a cache and re-sync from IMAP after a restore, and the search index rebuilds from the mail database.

## The backup sidecar

The compose file carries a `backup` service behind a profile, off by default. Turn it on from the install directory:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env --profile backup up -d
```

Each night it snapshots each distinct app and mail database file with `VACUUM INTO`, encrypts it with `age`, and ships it to an S3-compatible bucket via `rclone`. Retention defaults to 30 days. The variables (`BACKUP_AGE_RECIPIENT`, `BACKUP_RCLONE_REMOTE`, the `RCLONE_CONFIG_*` set for your provider) are documented in `remit.env.template`.

## Restore

Put the decrypted `remit.db` back on the `sqlite_data` volume, owned by uid 1000, and start the stack. Bodies refill from IMAP on the next syncs.

Test a restore before you need one: decrypt a backup with the `age` private key, `gunzip` it, and open it with `sqlite3`. A backup nobody has ever opened is a hope.

## What the updater does on its own

Every update snapshots the database before anything stops, and a failed update restores that snapshot itself. That covers a bad release. It does not cover a dead disk or a dead box, which is what the off-site copy is for.
