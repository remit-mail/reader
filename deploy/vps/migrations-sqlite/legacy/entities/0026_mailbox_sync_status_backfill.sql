-- Custom SQL migration file, put your code below! --

-- `sync_status` becomes total in the migration after this one
-- (docs/architecture/folder-rename-and-delete.md D1), and on a real install
-- almost every row is NULL: the sweep's insert is the one create path that
-- omits it, and the sweep is what discovers a folder in the first place.
--
-- SQLite cannot alter nullability, so drizzle-kit emits a copy-and-swap whose
-- `INSERT INTO __new_mailbox … SELECT` would violate the new NOT NULL on every
-- one of those rows — and drizzle wraps a folder's whole pending set in one
-- BEGIN/COMMIT, so the entities set would roll back and the migrate one-shot
-- that gates all six services would never complete. drizzle-kit does not emit
-- data migrations, so the backfill is written here and ordered ahead of it.
--
-- `synced` is the right value and not merely a safe one: a NULL row is a folder
-- the server told us about, which is a folder confirmed. Idempotent, so a
-- re-run over an already-total column is a no-op.
UPDATE `mailbox` SET `sync_status` = 'synced' WHERE `sync_status` IS NULL;
