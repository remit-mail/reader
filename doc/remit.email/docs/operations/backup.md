---
title: Backup
description: Two SQLite files and one key. Everything else re-syncs.
---

# Backup

Three files are worth protecting:

1. `remit.db`: accounts, identities, messages, settings, rules.
2. `vec.db`: the search vectors.
3. `.env`, for `FAKE_KMS_DATAKEY`: the key that decrypts every stored mailbox credential. No other copy exists, and no database backup replaces it.

Backups skip message bodies on purpose. Bodies are a cache and re-sync from IMAP after a restore.

## The backup sidecar

The compose file carries a `backup` service behind a profile, off by default. Turn it on from the install directory:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env --profile backup up -d
```

Each night it snapshots both database files with `VACUUM INTO`, encrypts each with `age`, and ships them to an S3-compatible bucket via `rclone`. Retention defaults to 30 days. The variables (`BACKUP_AGE_RECIPIENT`, `BACKUP_RCLONE_REMOTE`, the `RCLONE_CONFIG_*` set for your provider) are documented in `remit.env.template`.

## Restore

Put the two decrypted files back on the `sqlite_data` volume, owned by uid 1000, and start the stack. Bodies refill from IMAP on the next syncs.

Test a restore before you need one: decrypt a backup with the `age` private key, `gunzip` it, and open it with `sqlite3`. A backup nobody has ever opened is a hope.

## What the updater does on its own

Every update snapshots both databases before anything stops, and a failed update restores that snapshot itself. That covers a bad release. It does not cover a dead disk or a dead box, which is what the off-site copy is for.
