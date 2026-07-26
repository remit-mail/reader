# Design: the mail list as a server-side query

Status: proposed
Follows: [`docs/architecture/mail-list-boundary.md`](../architecture/mail-list-boundary.md) (PR #303), epic #315
Scope: the query shape per port, count semantics, the correctness of `thread_message.category`, the cutover, and every user-visible state the correction changes.

The architecture doc sets the boundary and decides D1–D8. This document decides how the queries are written, what the numbers mean, how the column they depend on is made correct, and what the user sees. Decision numbering continues from the architecture doc: D1–D8 live there, D9 onward here, so an issue can cite a decision without ambiguity.

Three of the architect's issues are corrected here rather than worked around. They are D9 (the index cannot live in the generated schema), D14 (the column the predicate depends on is not correct today), and #313's premise (the number on the Spam offer does not come from where the issue says it does). Each correction says what is wrong and why.

## What is in flight

Re-checked against `origin/main` and open PRs before designing.

- **PR #294** — filters: scope and expiry editable. Touches `packages/data-ports/src/types.ts` (a different type in the same file) and `packages/ui/src/components/filter-rule-editor.tsx`. #304 edits `SearchOptions` in that file; textual conflict only.
- **PR #292** — `listId` backfill for pre-upgrade mail. Establishes the shape a data repair ships in: an alternate entrypoint baked into the backend image, documented in `deploy/vps/README.md`, resumable, not a schema migration. D15 follows its reasoning and departs from its mechanism, for a stated reason.
- **PR #297** — semantic filters on incoming mail. `packages/imap-worker` only; no overlap.
- **PR #303** — the architecture doc. Not yet merged; this document references it by path and both land before any implementation.

Nothing in flight touches `MailboxPane`, `FlaggedList`, `enrichThreadRows`, `thread.ts`, or the drizzle `thread_message` repo.

## Part 1 — the query

### D9 — the category index is an out-of-schema index object, not a schema index

Issue #304 point 3 asks for "a schema index covering `(account_config_id, mailbox_id, category, sent_date)`, in the drizzle schema with a migration", and explicitly rules out `npm-scripts/*-search-index.sql` as "for FTS and trigram only". That is not implementable as written.

`packages/drizzle-service/src/schema/thread-message.ts` is one line — it re-exports generated entities. The drizzle schema is emitted from the `@index` decorators on `typespec/lib/models/ThreadMessage.tsp:13-86` by `@kattebak/typespec-drizzle-orm-generator`. The same decorators are read by `typespec-electrodb-emitter`, so declaring an index in TypeSpec mints a DynamoDB GSI as well as a SQL index. D2 says the DynamoDB port answers this predicate with a `FilterExpression`; a GSI would impose write amplification on every message write in a port that did not ask for one, to serve an index it will not use.

The index therefore ships where the repo already puts SQL-only index objects: `npm-scripts/sqlite-search-index.sql` and `npm-scripts/pg-search-index.sql`, as `CREATE INDEX IF NOT EXISTS`. Those files are applied idempotently by the migrator as its final step (`deploy/vps/migrate/run-migrate.ts`) and by the repo test harness (`packages/drizzle-service/src/test-db-sqlite.ts`), whose own header states the reason: "so repos run the exact search path they ship on". A category filter is a search index; the file's name is already accurate.

**I1**, in `sqlite-search-index.sql` and its Postgres twin:

```sql
CREATE INDEX IF NOT EXISTS tm_by_mailbox_category_date ON thread_message
	(account_config_id, mailbox_id, category, is_deleted, sent_date);
```

`is_deleted` sits before `sent_date` because every read in `packages/backend/src/handlers/thread.ts` passes `excludeDeleted: true` and none of them lets a caller turn it off — it is an equality, so it does not break the range, and including it makes a filtered count index-only.

Buys: a filtered page and an exact filtered count at constant cost for any category, no GSI on the out-of-tree port, no migration file, and the index is present in unit tests by construction. Gives up: the index is invisible to `vps-migrations-drift.sqlite.test.ts`, so nothing fails if someone deletes it — which is why D9 carries a query-plan assertion rather than trusting review.

Failure case: the index is absent or the planner ignores it, and a rare-category page silently costs a mailbox scan. The guard is a test that asserts `EXPLAIN QUERY PLAN` for the filtered window and the filtered count both name `tm_by_mailbox_category_date`. No `ANALYZE` is required: the index offers four equality columns against `thread_message_by_mailbox_id`'s two, so SQLite prefers it without statistics.

### D10 — the query is the existing keyset window with one more equality

`searchByMailboxWindow` and `countByMailbox` are unchanged in structure. `buildSearchConditions` (`packages/drizzle-service/src/repos/thread-message.ts:139-164`) gains one clause:

```
category IN (:categories)   -- when search.category is non-empty
```

Ordering, the `sent_date` + `thread_message_id` tiebreak and the cursor condition are untouched. `SearchOptions` (`packages/data-ports/src/types.ts:458-465`) gains `category?: MessageCategory[]`.

The ordering is `sent_date <order>, thread_message_id ASC` — a mixed direction that no index can serve as a pure seek. I1 satisfies the leading term, and both engines sort only within a tie group (SQLite block sort, Postgres incremental sort). A tie group is the messages sharing one `sent_date` in one mailbox and one category, which is one to three rows. Aligning the tiebreak with the order direction would remove the residual sort and is deliberately not done: it changes which row follows a cursor inside a tie group, so a user mid-pagination across the upgrade could see one duplicate or one skip. The residual sort is cheaper than that.

**Read cost, against the real instance** — INBOX holds 14,187 non-deleted thread messages: 4,753 `personal`, 88 `social`. Page size is 50.

| | fill one page of `personal` | fill one page of `social` | show all 88 `social` | exact `social` count |
|---|---|---|---|---|
| today, browser filter | 3 pages, 150 rows + 3 enrichment batches | 162 pages, 8,060 rows + 162 batches | 284 pages, 14,187 rows + 284 batches | not available |
| SQL predicate, no index | ~150 index entries + 150 row reads | ~8,060 | 14,187 | 14,187 row reads |
| SQL predicate, I1 | 50 index entries, 50 row reads | 50, 50 | 88, 88 | 88 index entries, no row reads |

The middle row is why the index is part of the same slice as the predicate and not a follow-up: a correct filter without an index turns a rare category into a mailbox scan, which is the cost profile the frugality rule exists to prevent.

### D11 — `category` on the response comes from the row, and stops being optional

`THREAD_LIST_ATTRIBUTES` (`thread.ts:35-53`) does not list `category`, and `toResponse` (`enrichThreadRows.ts:29-48`) does not map it, so `enrichThreadRows` batch-fetches the `message` table for a value already sitting on the row it just read. Note that `options.attributes` is accepted and ignored by the drizzle repo — every read is `select()` — so the projection list is documentation for the DynamoDB port, not a behaviour. Updating it alone changes nothing; the mapping in `toResponse` is the change that matters.

After #304 the served `category` is the `thread_message` value, the same value the `where` filters on. Filter and badge cannot disagree, because there is one source. The `message` batch-fetch stays for `authenticity` and `autoMoved`.

`ThreadMessageResponse.category` becomes required. It is `NOT NULL DEFAULT 'uncategorized'` on the row, so the server can always supply it, and its current `@doc` instructs the opposite of settled behaviour:

> "Absent for messages synced before classification rolled out — clients should treat this as `personal`."

That is the exact collapse issue #45 closed and `packages/web-client/src/lib/display-category.ts` deliberately contradicts. A doc that tells a client to fold unclassified mail into personal is a live invitation to regress D6. Once the field is required the instruction has nothing to describe and the `undefined` branch in `toDisplayCategory` becomes unreachable.

Buys: one source for the value, and the #45 instruction deleted rather than left in the contract. Gives up: an optional-to-required change on a response field. Generated TypeScript consumers get a narrower type, which no current caller breaks on; `toDisplayCategory` keeps its `| undefined` parameter so the seam stays tolerant.

### D12 — the cross-account filter needs a second index; the starred path needs none

#308 adds `category`, `unread` and `attachments` to `listAllThreads`. That handler has three modes (`packages/backend/src/handlers/unified-threads.ts:388-404`), each scoped by `mailbox_id IN (...)`:

- `listByStarred` — served by `(account_config_id, has_stars, sent_date)`. A starred collection is hundreds of rows, so `category` is a filter over an already-small ordered scan. **No index.**
- `listByDate` — served by `(account_config_id, sent_date)`. A per-category cross-mailbox query walks newest-first and discards non-matches: for `social`, ~1,600 rows to find 10. The brief needs seven of these plus seven counts on every load.
- `searchByDate` — the free-text mode, already trigram/FTS served.

**I2**, in the same two files, for the `listByDate` mode:

```sql
CREATE INDEX IF NOT EXISTS tm_by_category_date ON thread_message
	(account_config_id, category, is_deleted, sent_date);
```

`mailbox_id` stays a filter rather than an index column so `sent_date` remains the ordered trailing term across an `IN` list. I2 is not a prefix of I1 and I1 is not a prefix of I2; they answer different questions — one mailbox with a category, and one category across mailboxes.

Buys: the brief's sections cost a bounded seek each instead of a scan each. Gives up: a second index on the largest table, and I2 lands in #308 rather than #304, so #312's cost claim depends on #308 having shipped.

## Part 2 — the numbers

### D13 — `count` is the exact number of matching rows, independent of the cursor and of `results`

`countByMailbox` already runs a full `COUNT(*)` and then discards the answer with `Math.min(count, cap)` at `thread-message.ts:912`. Dropping the clamp removes a line and costs nothing: the scan already happens. It also already omits the cursor condition, so the number is the whole match set and does not shrink as the user pages. Both properties become stated contract rather than accident.

`executeThreadSearch` stops setting `count = items.length` and issues the count query whenever `count: true`, with or without `results`.

`count` is **absent** when `senderTrust` or `dkimMismatch` is present, per D4. It is not absent for `category`, which is why #304 must land first.

**The frugality rule, concretely.** `count` is one additional read over a whole match set, so it is requested per criteria set, never per page and never per keystroke:

1. The count is its own query, keyed on the criteria **without** the continuation token. A page fetch cannot trigger it.
2. `staleTime` of 60 seconds, matching `useStarredThreads`.
3. For chip-driven criteria the count is requested immediately — a chip is one deliberate act.
4. For free-text criteria the count is requested only for the same settled query string the list uses, and **never for a query under three characters**. `npm-scripts/sqlite-search-index.sql` documents that sub-three-character queries fall back to an unindexed folded `LIKE` scan; a count over a predicate the index cannot serve is a mailbox scan per character. Nothing may request a count the index cannot answer.

Failure case: a count request leaks into the list's own query options and fires once per page. The guard is a test asserting that fetching page two issues no count request.

### D14 — the read bound is reported as two values, and one helper derives the predicate

`ThreadSearchResponse` gains two fields, and `ResultList<T>` is left alone:

```tsp
@doc("Rows the server read while evaluating the criteria, including candidates it discarded. Pair with readLimit to tell a complete evaluation from a bounded one.")
rowsRead: int32;

@doc("Maximum rows the server was willing to read while evaluating the criteria. Absent means the criteria were evaluated over every row that could match, so any count is exact and no matches were left unexamined. This is not the page size — pagination is expressed by continuationToken.")
readLimit?: int32;
```

The distinction that makes the pair useful: `readLimit` bounds **criteria evaluation**, not pagination. A 50-row page of an on-row query has read exactly the rows it returns and discarded nothing, so `rowsRead` is 50 and `readLimit` is absent — the answer is complete for its page and the next page is reachable by token. The off-row path (`senderTrust`, `dkimMismatch`) reads a candidate window, enriches it and throws rows away, so `rowsRead` is the candidate count and `readLimit` is the window cap it used. If the window did not fill, `rowsRead < readLimit` and the evaluation was complete after all.

No boolean crosses the seam. One consumer-side helper derives the predicate once, in `packages/web-client/src/lib/result-count.ts`:

```ts
export type ResultCount =
	| { kind: "exact"; value: number }
	| { kind: "atLeast"; value: number; examined: number }
	| { kind: "unknown" };
```

`exact` when `count` is present. `atLeast` when `count` is absent and `readLimit !== undefined && rowsRead >= readLimit`, carrying the rows that did match and the number examined. `unknown` when no count was requested. Every surface renders a `ResultCount`; no surface reads `rowsRead` directly and no component re-derives the predicate.

Buys: one contract, no flag, and a single place where "was this bounded" is decided. Gives up: two fields on every search response including the many that will never be bounded, and a redundant `rowsRead` on the on-row path.

Deliberately not taken: letting the off-row path report an exact count when its window did not fill. It is derivable, and it would give the same criteria two behaviours depending on data volume. D4's "absent" stands.

## Part 3 — the column the predicate depends on

### D15 — the denormalized column is not correct today, and it is repaired before it becomes the predicate

The architecture doc states that `thread_message.category` is written by body-sync as the copy the read path serves, and measured that on the live instance's INBOX it agrees with `message.category` on every row. Both are true. Neither makes the column trustworthy, because the read path has never used it — `enrichThreadRows` goes to the `message` table — so nothing has ever depended on the write path being complete. Four defects survive in it, verified against `origin/main`:

1. **Inverted write order in the retro path.** `backfillClassification` (`packages/mailbox-service/src/body-sync.ts:929`) writes `Message` at `:945` and then `ThreadMessage` at `:946`, while its skip guard at `:933-938` keys off `message.category`. A crash or throw between the two leaves `message.category` decided and `thread_message.category` stranded at `uncategorized` forever: the caller captures the error at `:319`, requeues the id, and the retry hits a now-satisfied guard. The live path has the opposite order and says why — `applyPostStoreSteps` writes the ThreadMessage at `:652` and the Message last at `:787`, with the comment "Written LAST so bodyStorageKey — the skip-guard signal — is only durable once the parsed cache AND the move (when any) are." The retro path contradicts its own file.
2. **One arbitrary row per message.** `denormalizeCategory` (`:1485`) resolves the row through `getByMessageId` → `findByMessageId` (`packages/drizzle-service/src/repos/thread-message.ts:666-681`), a `.limit(1)` with no `orderBy`. A message in two mailboxes has two rows; one gets the category and the other keeps `uncategorized`, and which one is planner-dependent. The codebase treats multiplicity as normal everywhere else — `flag-queue.ts:121` and `:182` iterate `findAllByMessageId`, with the reason stated at `:166-169`.
3. **A row created after classification never gets the value.** `createThreadForMessage` (`packages/mailbox-service/src/message-sync.ts:1404`) creates thread messages without a category, so they default to `uncategorized`. That is correct when the message is new and unclassified. It is wrong when metadata sync discovers an already-classified message in a second mailbox: the new row starts `uncategorized` and `denormalizeCategory` will not run again, because the guard sees the message already classified.
4. **No test asserts the column round-trips.** The Postgres integration DDL at `packages/drizzle-service/src/repos/thread-message.test.ts:31-63` is `CREATE TABLE IF NOT EXISTS` and omits both `category` and `list_id`, so it silently reuses whatever table exists. `packages/data-ports/src/conformance/` has three files and covers labels only; there is no thread-message conformance suite at all.

Adjacent, and not fixed by any of the above: `create()` is `onConflictDoNothing` over a deterministic `threadMessageId` (`thread-message.ts:245-257`), so re-creating an existing row discards a supplied `category` and returns the existing row. A replayed sync therefore never repairs anything. Repair is the business of D16, not of `create()`; making `create` upsert would change insert semantics for every field to fix one.

The four defects are fixed in the write path before the client depends on it: the retro path writes ThreadMessage first, `denormalizeCategory` iterates `findAllByMessageId`, and `createThreadForMessage` carries the category its caller already holds from the Message it just saved — which is `uncategorized` on the common path, so no read is added.

Buys: the column becomes as correct going forward as the value it copies. Gives up: three write-path changes in a package the epic did not otherwise touch, and the retro path's guard has to move to a signal written last.

### D16 — the historical repair is one SQL statement in a one-shot that runs before the app

PR #292's `listId` backfill is a resumable, checkpointed, paged pass because it re-derives a value from raw stored bytes, one message at a time, off the storage backend. Category needs none of that: the value already exists in the same database, one join away. The repair is set-based:

```sql
UPDATE thread_message SET category = (
	SELECT m.category FROM message m WHERE m.message_id = thread_message.message_id
)
WHERE EXISTS (
	SELECT 1 FROM message m
	WHERE m.message_id = thread_message.message_id
	  AND m.category <> thread_message.category
);
```

No checkpointing, no resumability, no batching — an interrupted run leaves a consistent table and re-running finishes the job. It is idempotent by construction: after it runs the `WHERE` matches nothing, and it only ever writes the value body-sync would write.

Where it runs is the part #292 gets to decide differently. #292 ships as a documented manual command, which is right for `listId` — #263 accepted forward-only matching as a fallback. It is wrong here. If an admin skips this command, an upgraded instance sends `category` to a server that filters on a stale column, and the reported bug returns in a new costume: a filtered list that under-returns old mail, now with no client-side filter to mask it. Correctness cannot be opt-in.

The repair ships as its own entrypoint bundled into the backend image, in the same shape as `migrate.mjs` and #292's script, and is invoked by the same compose one-shot that runs the migration, immediately after it. `deploy/vps/migrate/run-migrate.ts` keeps its stated contract — "This migrator applies generated schema migrations and installs the idempotent DDL objects around them. It does not rewrite row content" — untouched and true.

**An instance mid-sync.** The one-shot runs after migrate and before the app and workers start, so there is no concurrent writer during an update. The statement is safe even with one: it writes only what body-sync would write, so a row updated by both gets the same value twice. A row whose message has no body yet has nothing to copy and stays `uncategorized`, which is correct — body-sync will fill it, and with D15's fixes it will fill every row for that message.

Cost: one join scan of `thread_message` per update. 14,187 rows is milliseconds; a 500,000-row corpus is seconds, once per update, with the app already down.

Buys: the filter cannot go live against a stale column, and the repair is small enough to read in one sitting. Gives up: every update pays a scan that will find nothing after the first, and a second command in the update path.

### D17 — the repair is verified by a divergence count on real data

The same entrypoint takes `--check`, which writes nothing and reports:

- rows where `thread_message.category <> message.category`, total and per mailbox
- rows whose `message` row is missing
- rows still `uncategorized` **whose message is also `uncategorized`** — the not-yet-classified cohort, reported separately so it cannot be mistaken for a failed repair
- the per-category tally, before and after

`--check` runs on every update alongside the repair and logs its numbers, so an upgrade leaves evidence rather than an assumption.

Verification on real data is the live instance, not a fixture: run `--check` before the repair, record the divergence, run the repair, re-run `--check` and expect zero divergence and an unchanged not-yet-classified cohort. The architecture doc's measurement predicts near-zero divergence for INBOX on that instance; defect 2 and 3 in D15 predict non-zero divergence in mailboxes that hold a second copy of an INBOX message, such as Archive and the Gmail-style label folders. `--check` settles which is true. If divergence is zero everywhere, that is a real result and it is reported, not hidden — the repair still ships, because the defects that produce divergence are in the write path and untested instances are not this instance.

## Part 4 — the cutover

### D18 — every deploy skew degrades to today's behaviour, and the only true gate is the repair

There is no window where the list is wrong, and the reason is that the client-side predicate is idempotent over a server-filtered set. Filtering `personal` twice yields the same rows as filtering once.

| | old server | new server |
|---|---|---|
| **old client** | today | today — the client sends no `category`, so nothing changes |
| **new client** | the server ignores `category`, the client's own filter still applies: today's behaviour | fixed |

The bottom-left cell is the important one: a new client against an old server is not a broken list, it is the current bug. That holds during a rolling update and holds if a slice lands out of order.

The ordering that does matter:

1. **#304 and the D15 write-path fixes** — additive; no client sends `category` yet.
2. **D16's repair** — must be in the same release as #304 or earlier, and must run before the app serves traffic. It is the only hard gate.
3. **#305** — count semantics; additive.
4. **#309** — the states, as stories.
5. **#306** — the client sends `category` and its local filter is deleted in the same change.

Deleting `applyInboxFilters` in the same change that starts sending `category` is safe precisely because running both would have been safe too. There is no flag and no dual-path period.

Two client-side hazards the cutover creates, neither of which existed while the filter was local:

**The previous predicate's rows must never render under the new filter.** The list query re-keys on the filter, and `placeholderData: keepPreviousData` (`MailboxPane.tsx:336`) then renders the old predicate's rows while the new page is in flight — a list that is visibly wrong for one round trip, which is the exact failure this epic is about. On a filter change the list renders the transition state (Part 5, S4), not stale rows. Pagination within one filter keeps `keepPreviousData`.

**The open thread must survive a filter change.** `MailboxPane.tsx:407-411` resolves the reading pane against the unfiltered `rawThreads` "so a filter never closes the reading pane". After the cutover there is no unfiltered set in the client. The selected row is snapshotted into state when the user selects it, and the reading pane resolves from that snapshot before falling back to the list. This is a derivation over what the user selected, which D-boundary keeps client-side. Proof: select a thread, apply a filter it does not match, the reading pane stays open.

## Part 5 — the user-visible states

The bug renders as an empty list. So the empty states are the design.

### D19 — an empty filtered list states how much was read; that is what makes it different from the bug

A user cannot distinguish "no personal mail" from "we only looked at the newest 50" by looking at an empty list, and no amount of correct backend work fixes that on its own. Every filtered empty state therefore carries a completeness sentence, and there are exactly two things it can say: everything was checked, or a stated bound was checked. A filtered empty state with no completeness sentence is not an acceptable state.

**S1 — unfiltered, empty mailbox.** Unchanged: `No messages in this mailbox`.

**S2 — filtered, complete read, no matches.**

> **No Personal mail in Inbox**
> Every message in this folder was checked.
> `Clear filter`

With a search query as well: headline `No results for “invoice” in Personal`, same body.

**S3 — filtered, bounded read, no matches.**

> **No matches in the newest 500 messages**
> Older mail was not checked — this filter can only look at the newest 500 messages.
> `Clear filter`

Reachable only through `senderTrust` or `dkimMismatch`, which D7 leaves off-row. The mailbox list cannot produce it today; the state exists and is storied because D7 keeps the path alive and the next filter to arrive may land on it.

**S4 — filter changed, pagination restarted.** The loading skeleton, never the previous predicate's rows and never an empty state. `listState` must not resolve to `empty` while a fetch for the current criteria is in flight.

**S5 — filtered, with results.** Rows, plus the result header (D20). The filter's identity is visible in the header so a filtered list is never mistaken for the mailbox.

**S6 — filtered, fetching a further page.** Rows already rendered plus a footer that says so in words. Today the footer is a bare spinner (`MessageList.tsx:1429-1433`), which is one of the ways "not fetched yet" currently reads as "nothing there": `Loading more…`.

**S7 — error.** Unchanged: `Couldn't load messages` / `Retry` / `Report a problem`.

`FlaggedList` uses the same kit empty state and therefore shows `No messages in this mailbox` for a cross-account collection that is not a mailbox. The empty component takes its scope label from the caller: `No starred mail`, and filtered, `No starred Personal mail` with the same completeness sentence.

### D20 — the count reaches a component as a resolved value, and the header states the total the footer counts against

A new `packages/ui/src/components/list-result-header.tsx` replaces the module-private `SearchResultsHeader` (`MessageList.tsx:182`), which has no story and no test. It takes a `ResultCount` from D14 and a scope, and renders:

| `ResultCount` | scope | copy |
|---|---|---|
| `exact` | filter only | `4,753 Personal messages` · `1 Personal message` |
| `exact` | search only | `312 results for “invoice”` |
| `exact` | both | `312 results for “invoice” in Personal` |
| `atLeast` | any | `12+ results` — then, muted: `only the newest 500 messages were checked` |
| `unknown` | search only | `Results for “invoice”` and no number |

A bare number is never rendered for a bounded read. Numbers go through `formatNumber`, so a five-figure total reads `14,187`.

The footer states progress against that total, which is the durable cure for this class of bug — the difference between "50 shown" and "50 exist" is on screen at all times:

- more remain, exact total: `Showing 50 of 4,753`
- more remain, bounded: `Showing 50 · only the newest 500 messages were checked`
- fetching: `Loading more…`
- exhausted: nothing; the header total already equals what is rendered

### D21 — one category presentation table

Five independent category tables exist and have drifted:

- `packages/ui/src/filter-presets.ts:35` `MESSAGE_CATEGORIES` — inbox chips. **No `uncategorized` entry**, so unclassified mail is not filterable from the inbox at all, which D6 requires it to be. `marketing` is `warning` here.
- `packages/ui/src/components/app-shell-types.ts:327` `categoryTone` — the only colour mapping. `marketing` is `neutral` here.
- `packages/ui/src/components/app-shell-types.ts:180` `briefCategories` — brief chips, label `Unclassified`.
- `packages/ui/src/components/category-badge.tsx:25` `CATEGORY_LABELS` — label `unclassified`, plus `notification` and `receipt` for `automated` and `transactional`.
- `packages/web-client/src/lib/brief.ts:101` `CATEGORY_SECTIONS` — label `Unclassified`.

Separately, `message-row.tsx:164` renders the raw enum string rather than calling `getCategoryLabel`, so a row badge reads `uncategorized` while `CategoryBadge` renders `unclassified` for the same value.

One table in `packages/ui`, keyed by `MessageCategory`, carrying label and tone; every surface reads it. Labels: `Personal`, `Unclassified`, `Newsletter`, `Marketing`, `Automated`, `Transactional`, `Social`. Tones follow `categoryTone`: `personal` accent, `transactional` positive, `social` warning, the rest neutral. `personal` still renders no badge on a row. `uncategorized` keeps its own label and its own section everywhere, and one test asserts that a row whose category is `uncategorized` renders neither the personal label nor no label at all — the mechanical guard for #45 that D6 asks for and nothing currently provides.

The inbox chip row gains `{ id: "uncategorized", label: "Unclassified" }` after `Personal`, matching the brief's order.

Buys: the drift closes, and `uncategorized` becomes filterable where D6 says it must be. Gives up: a table move touching several kit components, inside an epic that is otherwise about queries.

### D22 — the brief paginates by section, not as a page; each section is a bounded top-N with an honest total

#312 must answer the question #197 left open and record it there. The answer:

The brief does not paginate as a whole. Each category section is its own query — `listAllThreads` with `category`, `limit: SECTION_ROW_CAP` — plus one `count: true` request for its true size. `Show N more` stops slicing loaded rows and fetches that section's next page. `groupBriefSections` becomes a pure regrouping of complete per-section responses, and `mergeSearchRows` operates on complete result sets or goes away.

The alternative — one unified page plus seven counts — is rejected because it produces a section header reading `Marketing 3,942` above zero rows whenever that category's mail is older than the unified window. That is more misleading than today's understated number, not less.

**Read cost.** Today: one 50-row read and one 200-row read, 250 rows plus two enrichment batches. After: seven 10-row seeks, 70 rows, plus seven index-only counts. The counts read one I2 index entry per message in the brief's scope, once per brief load with a 60-second `staleTime` — 14,187 entries on this instance, no row reads. That is fourteen small requests where there were two, and fewer rows read. It is not free and it is not per keystroke.

A section whose count is bounded or absent renders no number rather than a bare one, per D20.

### D23 — the stories come first, and the components live in the kit

Per D8, in wave order: `list-result-header.tsx` (new), `message-list-state.tsx` (which has a render test and **no story file** today), the list footer, `brief-section.tsx`, and the category table all get stories before any app change consumes them. `message-list-state.tsx` gaining its first story is not optional: it is the component that renders the empty state this whole epic is about.

Story render tests follow the existing convention exactly — `.render.test.ts`, never `.tsx`, `node:test` plus `renderToString`, asserting on the literal user-facing copy, state reached through `initial*` props. The `packages/ui` test glob is `src/**/*.test.ts`, so a `.tsx` test never runs.

The states that must render distinguishably, asserted in tests rather than reviewed by eye: S2 against S3 (complete versus bounded), S2 against S4 (empty versus fetching), S2 against S1 (filtered-empty versus empty mailbox), and an `atLeast` count against an `exact` one.

### D24 — the selection count arrives in one request, so the running count goes

`countMatches` (`packages/web-client/src/lib/bulk-actions.ts:210`) is deleted with its progressive `Counting… 1,284 so far` label and the `≥ 5000` variant that appends `This is a big result set.` The replacement is a plain in-flight label with no number — `Counting…` — resolving to the existing `All 1,284 matching your search selected`. An exact total is its own warning; a threshold sentence on top of it is noise.

The delete confirmation loses `about` and nothing else: `Move 1,284 messages to Trash?`. The snapshot sentence stays for predicate-sourced selections, because it was never about count accuracy — mail still arrives during a delete.

The Spam offer's copy is unchanged; only its number changes. Note that #313's premise is off: the number rendered is `heldOutSpamCount` (`packages/ui/src/components/search-results.tsx:318`), summed across held-out sections, and `spamOfferForResults` only picks the destination folder. So the fix is that `heldOutSpamCount` becomes a sum of server counts over the junk mailboxes in scope, not that `spamOfferForResults` counts differently. When any of those counts is absent the offer renders `Results from Spam` with no number and keeps its `Go to Spam` action.

## Gaps closed with new issues

- **#304 correction** — the index is out-of-schema (D9), and the read-side change includes mapping `category` in `toResponse` and making it required (D11), neither of which the issue mentions.
- **New: the write path for `thread_message.category`** — D15's four defects. No existing issue covers any of them.
- **New: the historical repair and its verification** — D16, D17. Blocks #306.
- **New: thread-message conformance and integration DDL** — D15 defect 4. The integration test applies `deploy/vps/migrations-sqlite/entities` through the drizzle migrator instead of hand-written DDL, which makes drift structurally impossible rather than merely fixed.
- **#314 extension** — D21's category table, alongside the predicate tables the issue already collapses.

Adjacent and not in scope: `message-move.ts:493-514` carries `category` to a copied row but not `listId`, so a copy loses the denormalization `ListId` filter clauses match on. That belongs to #263 and is noted there.

## FAQ

**Why not just filter by joining to `message.category` and skip the denormalized column entirely?** Because the join has to happen before the limit. To find 50 `social` rows the planner would probe the `message` table for every candidate in the mailbox — 8,060 probes for one page, 14,187 to exhaust the category. The on-row predicate exists so the engine can seek. D1 is right.

**If the live instance's INBOX already agrees on every row, why bother with a repair?** Because nothing has ever read the column, so nothing has ever depended on the write path being complete, and three of its four defects produce divergence in mailboxes that hold a second copy of a message — Archive and label folders, not INBOX. `--check` reports the real number before the repair writes anything. If it is zero, that is the result and it gets reported.

**Why is the repair automatic when the `listId` backfill is a manual command?** Because forward-only matching was an accepted outcome for `listId` and is not one here. Skipping this repair means an upgraded instance filters on a stale column and the reported bug comes back with the client-side filter no longer masking it.

**Why not put the repair in the migrator?** `run-migrate.ts` states that it applies DDL and never rewrites row content. Breaking that to save a line in a compose file trades a clear contract for convenience. The one-shot that runs migrate runs this immediately after, which gives the same ordering guarantee.

**Does the exact count make a large mailbox slow?** The count already runs today as a full `COUNT(*)`; the change is that the answer stops being thrown away. With I1 it is an index-only range count — 88 entries for `social`, 4,753 for `personal`. What would make it slow is coupling it to keystrokes, which D13 forbids in four specific ways, including never counting a query shorter than the trigram floor.

**Why two indexes?** They answer different questions: one mailbox filtered by category, and one category across mailboxes. Neither is a prefix of the other, and the second only becomes necessary when #308 gives `listAllThreads` a category filter.

**Why does the index live in a `.sql` file instead of the schema?** The drizzle schema is generated from TypeSpec `@index` decorators, and those same decorators mint a DynamoDB GSI. Declaring the index in the schema would charge write amplification to a port that D2 says answers this predicate with a `FilterExpression`.

**Why not a `truncated` flag instead of two numbers?** Because a flag has to be recomputed by whoever wrote the port and believed by everyone downstream, and it cannot distinguish "the cap was hit" from "the cap existed and was not reached". `rowsRead` with `readLimit` carries both, and exactly one client-side helper turns the pair into the three cases a UI can render.

**Why is `readLimit` absent rather than a large number on the SQL path?** There is no honest number for "no bound". Absence is the same convention D4 already chose for `count`.

**How does a user tell "no personal mail" from "we only looked at the newest 50"?** The empty state says which. Complete reads say every message in the folder was checked; bounded reads name the bound. An empty filtered state with neither sentence is not a state this design permits.

**Do the filters survive a reload?** No. `filterCategory` and `filterAttributes` are local component state and stay that way — the URL carries `selectedMessageId`, `selectedThreadId` and `q` today. Putting filters in the URL is a real improvement and it is not this correction; nothing in the bug or the fix depends on it.

**Can a user filter to more than one category at once?** No. The chips are single-select today and stay single-select; the server parameter is an array and receives one element. Multi-select is a UX change with no defect behind it.

**Fourteen requests to load the brief — is that not the runaway pattern?** They are seven bounded seeks and seven index-only counts, issued once per brief load with a 60-second `staleTime`, replacing two requests that read 250 rows. Fewer rows are read than today. The rule the frugality guard actually protects is that nothing scans per keystroke, and nothing here is on a keystroke path.

**What happens to `uncategorized` mail?** It gains a chip it never had in the inbox, keeps its own label and its own brief section, and gets a test that fails if it ever renders as personal or as nothing.
