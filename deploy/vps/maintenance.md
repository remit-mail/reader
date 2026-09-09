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
- **uncategorized** counts mail with no category whose message has none either.
  It is not the same as "not classified yet": it mixes mail the classifier has
  not reached with mail it reached and had nothing to say about. To separate
  them, `SELECT classification_state, count(*) FROM message WHERE category =
  'uncategorized' GROUP BY 1` — `NotExamined` is the cohort a classifier release
  could still pick up.

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

## Classification backfill for pre-upgrade mail

The header classifier that sorts mail into `transactional`, `newsletter` and
the rest runs at body-sync time, and `message.classification_state` records
that it ran. Mail whose body was stored before the classifier examined it
keeps the default `NotExamined` and stays `uncategorized` in the list — the
category filter matches the thread row's copy, which was never written. A
one-time backfill classifies each such message from its already-stored raw
source (no IMAP refetch, no placement or filter side effects — filing
decisions already ran, or were declined, when the body first landed) and
marks it `Examined`. A message that already carries a real category is
recorded as examined without re-deriving it: the category is write-once:

```bash
docker compose -f docker-compose.sqlite.yml --env-file .env run --rm backend \
  node backfill-classification.mjs
```

Safe to interrupt: it checkpoints to
`/data/sqlite/classification-backfill-checkpoint.json` after every batch and
resumes from there on the next run, and a message already examined is left
alone on a rerun. Run it once after upgrading from a release that predates
`Message.classificationState`.
