# Reader — one-off maintenance jobs

Companion to the [deployment README](README.md).

## The category repair

The mail list filters on `thread_message.category`, a copy of `message.category`
kept on the row. The `migrate` one-shot repairs any row whose copy disagrees,
and logs what it found before and after. It writes only rows that need it.

To look without waiting for an update:

```bash
remit check-categories
```

That reports and changes nothing (the database is opened read-only) and prints
each figure with the cause it measures and the result a healthy instance is
expected to produce. Most of them are zero. Two are not defects:

- **ahead** counts rows classified while their message is still pending, a
  classification in flight. Those rows are left alone.
- **not-yet-classified** counts mail the classifier has not reached.

## ListId backfill for pre-upgrade mail

Filters can match on a mailing list's `List-Id`, but the field is only populated
at body-sync time, so mail synced before v0.2.5 keeps it empty and a `ListId`
clause under-matches the back catalogue. A one-time backfill derives it from each
message's already-stored raw source (no IMAP refetch) and writes only that field:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env run --rm backend \
  node backfill-list-id.mjs
```

Safe to interrupt: it checkpoints to
`/data/sqlite/list-id-backfill-checkpoint.json` after every batch and resumes
from there on the next run, and a message already backfilled (or one that never
carried a `List-Id`) is left alone on a rerun. Run it once after upgrading from
a release older than v0.2.5.
