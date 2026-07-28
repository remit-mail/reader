# The mail list is a server-side query

Status: proposed
Scope: `listThreads`, `searchThreads`, `listAllThreads`, the drizzle `thread_message` repo, and every web-client surface that renders a list of mail.

## What the boundary is

A mail list is the result of a query the server runs. The server decides which rows are in the list, in what order they appear, how many there are in total, and where the next page starts. The client asks for a page and renders it.

The test for whether a derivation is on the wrong side of this boundary is one question: **does its result change when another page loads?** If yes, it is a server concern and its current client-side implementation is a defect, not a style choice. A filter, a count, a sort, or a grouping computed over "the pages fetched so far" is wrong at every moment except the one where every page happens to be loaded.

## What the boundary is not

It is not a rule that the client may never compute anything over rows.

Three kinds of client-side derivation are correct and stay where they are. First, derivations over a **complete** server response — summing `unseenCount` across a full list of mailboxes, filtering a non-paginated outbox. The window is the whole set, so no page load can change the answer. Second, derivations whose subject **is** the loaded window — which rows are selected, which row the keyboard moves to next, whether every visible row is selected. "What the user can see" is legitimately defined by what has been fetched. Third, **per-row presentation** — mapping a category value to a label, formatting a date, deriving a display string. These have no window at all.

It is also not a claim that the two storage ports must behave alike in cost. They must agree on what an answer *means*; they may differ in what it costs them to produce it.

## The failure case

The inbox category filter shows an empty list on a mailbox holding thousands of matching messages.

On a live instance, INBOX holds 14,187 non-deleted thread messages: 4,753 `personal`, 3,942 `marketing`, 2,680 `automated`, 2,295 `newsletter`, 429 `transactional`, 88 `social`. Zero rows are uncategorized, and `thread_message.category` agrees with `message.category` on every row. The data is not at fault.

The newest 100 rows are 77 `automated`, 14 `newsletter`, 3 `marketing`, 2 `social`, 2 `transactional`, and 2 `personal`. Personal mail is the bottom third of this inbox by recency.

`applyInboxFilters` (`packages/web-client/src/components/mail/MailboxPane.tsx:136`) filters `t.category` in the browser over `threadsData.pages.flatMap(...)`. The list query (`MailboxPane.tsx:327`) calls `threadOperationsListThreads` with `{ order, continuationToken }` and no filter of any kind. `DEFAULT_THREADS_PAGE_SIZE` is 50 (`packages/backend/src/handlers/thread.ts:27`). Selecting "Personal" therefore filters 50 rows that contain, on this mailbox, two matches — and selecting "Social" filters 50 rows that contain none.

The cost of not fixing it is the same number read the other way. To fill one screen of 50 `social` rows by client-side filtering, the client must read roughly 8,060 rows — 162 pages. To show all 88 `social` rows it must read all 14,187 — 284 pages, each one also triggering an `enrichThreadRows` batch read of up to 50 messages and their addresses. A server-side `where` returns 50 rows in one query.

## Decisions

### D1 — `category` is an on-row predicate, not an off-row criterion

`OffRowCriteria` (`packages/backend/src/derive/filterThreadCriteria.ts:7`) documents its three members as fields that "live on the underlying Message/Address, not on the ThreadMessage DynamoDB item". That is true of `senderTrust`, which is derived from `AddressItem.flags`, and of `dkimMismatch`, which is derived from `MessageItem.authenticity`. It is false of `category`.

`ThreadMessage.category` is declared on the entity with a default (`typespec/lib/models/ThreadMessage.tsp:179`), ships as `category text DEFAULT 'uncategorized' NOT NULL` (`deploy/vps/migrations-sqlite/entities/0000_happy_roland_deschain.sql`), is written by body-sync, and is already present on `CreateThreadMessageInput`. The write path states its purpose outright: it is "the copy the list/search read path serves without a per-row Message fetch" (`packages/mailbox-service/src/body-sync.ts:1474`). The read path ignores it and re-fetches the value from the `message` table instead.

`SearchOptions` (`packages/data-ports/src/types.ts:457`) gains `category`. The drizzle port applies it as a SQL `where` alongside the boolean filters it already pushes down. `filterByOffRowCriteria` keeps `senderTrust` and `dkimMismatch` and loses `category`.

Buys: an exact filter over the whole mailbox, a full page of matches per request, and a count that can be computed in SQL. Gives up: a schema index on `category` and a migration to add it, plus one more predicate the out-of-tree DynamoDB port must implement as a `FilterExpression` over the item it already reads.

Amended by [`docs/design/mail-list-server-query.md`](../design/mail-list-server-query.md) D9: the index is declared with the drizzle generator's `@indexDef`, which emits SQL only. A TypeSpec `@index` was not an option — all five LSI slots are taken and this file's own note says a sixth can never be added, so it could only have been a GSI.

### D2 — the port seam promises filtered, ordered, paginated rows; each port implements it natively

The alternative was for the seam to promise rows and have a shared layer filter them. That is what `executeThreadSearch` does today and it is the reason a filtered page can come back empty with a continuation token attached.

Filtering, ordering and counting move behind `IThreadMessageRepository`. A port that can answer a predicate in the storage engine does so. A port that cannot must still return a full page of matches, which for DynamoDB means a `FilterExpression` with a refill loop — that is DynamoDB's ordinary pagination contract, not a special case.

Buys: one meaning per method, no shared post-filter layer to keep honest, and no correctness difference between ports. Gives up: the DynamoDB port carries the refill loop and pays read capacity for rows a `FilterExpression` discards, which for a low-frequency category on a large mailbox is a real charge.

### D3 — the ports differ in cost, not in meaning, and the response says which

The two ports do not diverge in semantics. They diverge in whether they can afford an unbounded read, and that difference is expressed in the response rather than left to the caller to guess.

The response carries the read bound that produced it as a value — the number of rows read and the limit that applied — not a `truncated` flag. A caller derives whether the answer was bounded. The SQL port, which indexes the text and the predicates, reports an unbounded read. A port that must bound the read reports the bound it used.

Buys: a single documented contract; a client that never has to know which backend it is talking to; no silent truncation. Gives up: two additive fields on the search response, and every port now has to report its read bound honestly rather than inheriting a shared cap.

**Not implemented.** [`docs/design/mail-list-server-query.md`](../design/mail-list-server-query.md) D14 withdraws the two response fields and the refill loop in D2: there is no second port in this repository to disagree with the SQL one, and the values the fields would have carried were a page length rather than a bound. The divergence stays documented here as the thing to design when a second port lands.

This supersedes the current arrangement, in which `countByMailbox` computes the exact SQL count and then discards it with `Math.min(count, cap)` (`packages/drizzle-service/src/repos/thread-message.ts:883`) purely to imitate DynamoDB's window semantics.

### D4 — `count` means the exact number of matching rows in the mailbox

`count` currently means four different things depending on which flags accompany it: the length of the returned page when `results` is on, the length of the post-filter page when an off-row criterion is present, and `min(exact, 500)` in count-only mode. None of those is a count of matches.

`count` becomes the number of rows in the mailbox matching the criteria, independent of paging and of `results`. When any off-row criterion is present the exact count is not derivable without enriching every candidate row, so `count` is **absent** and the read-bound fields from D3 stand in its place. Absent is honest; a page length labelled `count` is not.

`count` stays opt-in (`count: true`), because it is an additional read over the whole match set. It must not be coupled to keystrokes: on this mailbox an exact count is one index range scan on SQLite, and a full partition read on DynamoDB.

Buys: a number the UI can show without hedging, and the removal of `countMatches` (`packages/web-client/src/lib/bulk-actions.ts:218`), which today pages an entire result set through the browser to learn its size. Gives up: one extra query per counted request, and a count that is genuinely expensive on DynamoDB rather than cheap and wrong.

Stands as a decision; not implemented in the slice that fixes the reported bug. It moves to #305 with every surface that would render a number — see [`docs/design/mail-list-server-query.md`](../design/mail-list-server-query.md) D13 and D20. The read-bound fields this decision leans on are withdrawn (D14); an absent `count` needs no new field, since `count` is already optional.

### D5 — the inbox filter needs no new endpoint and no new parameter

`searchThreads` already accepts `category[]`, `continuationToken`, `order`, `unread`, `starred`, `attachments`, `count`, `results` and `limit` (`typespec/main.tsp:430-483`). The client does not send `category` or `starred` to it, and for an unfiltered listing it uses `listThreads`, which accepts no filters at all.

The correction on the API surface is therefore: no new endpoint, no new query parameter, and no change to any request shape. What changes is the client sending a parameter that already exists, the backend making that parameter behave as documented, and the `@doc` strings on `category`, `count` and `limit` being corrected — they currently describe the defective semantics ("resolved by in-handler enrichment over the capped window", "count of matches within the server-capped window") as if intended. The only additive change is the two D3 response fields.

The client routes the mailbox list through `searchThreads` whenever any filter or query is active and keeps `listThreads` for the unfiltered case, passing `limit: 50` explicitly — an unspecified `limit` clamps to 500 (`clampThreadSearchLimit`), so switching paths without it would quietly multiply the page size by ten.

Buys: the bug closes with zero new API surface, and the two list paths converge rather than diverge further. Gives up: the mode switch stays in the client, so `listThreads` and `searchThreads` both remain — the choice between them is deferred to issue #197, not made here.

### D6 — `uncategorized` remains a filterable value

`MessageCategory` includes `uncategorized`, `ThreadMessage.category` defaults to it, and its TypeSpec doc already frames the pending state as "a named value, not absence". A server-side category filter must be able to express it, and `toDisplayCategory` (`packages/web-client/src/lib/display-category.ts:17`) must keep mapping it to its own section rather than folding it into `personal` (issue #45).

Buys: the chip keeps working for pre-classification rows, and D1 does not regress a closed bug. Gives up: nothing.

### D7 — `dkimMismatch` and `senderTrust` stay off-row for now

Both could be denormalized onto `thread_message` the way `category` was, and `dkimMismatch` is the better candidate of the two because `MessageItem.authenticity` is immutable once synced, whereas `senderTrust` derives from mutable VIP flags and would fan out a write to every row from a sender on each change.

Neither is denormalized here. The only shipped surface that filters on them is the spam-rescue panel (`packages/web-client/src/hooks/useRescueCandidates.ts`), which issues one bounded 500-row query and is a bounded panel by design, not a paginated list. The cost of doing it anyway is a schema change plus a backfill over every existing message, for no surface that needs it.

Buys: the correction stays inside one release with no data migration beyond an index. Gives up: the off-row path survives, so those two filters keep returning short pages, now with the D3 bound visible instead of implied.

### D8 — every user-visible state lands in Storybook before the app wires it

Storybook is the first landing place for a changed or new UI state, not a mirror of one. A story that renders the state comes first, in its own change, and the app wiring depends on it. Where a slice alters an existing component's states, the existing stories are updated in that same story-first change rather than afterwards.

This bug is the argument for the rule. The defect is a list that renders empty when it should not, and an empty list is indistinguishable from a correct empty result unless someone has looked at both side by side. The states that must exist as stories before any of this is wired are: a filtered list with results, a filtered list that is genuinely empty, a filtered list fetching a further page, and whatever represents a count that is bounded or absent under D3 and D4. A count marker with no story is a marker nobody has seen.

Buys: each state is reviewable in isolation before app code depends on it, the app and the kit cannot drift, and the filtered-empty case gets looked at deliberately instead of being discovered in production. Gives up: an extra hop for every slice with a surface — the story issue must land before the wiring issue starts, which serializes work that could otherwise proceed in one pass.

## Audit

Every place the web client derives, filters, counts, sorts, groups or dedupes mail-list data. "Window" is the data the derivation runs over.

### Must move to the server

| # | Location | Derives | Window |
|---|---|---|---|
| 1 | `MailboxPane.tsx:136` `applyInboxFilters` | category + unread/flagged/attachment filter | loaded pages — the reported bug |
| 2 | `MailboxPane.tsx:481` `unreadCount` | unread count | server `unseenCount` with a loaded-pages `??` fallback that silently undercounts |
| 3 | `MailboxPane.tsx:863` `searchResults` | maps already-client-filtered rows | inherits #1 |
| 4 | `MessageList.tsx:1365` `SearchResultsHeader count` | "N results for …", shown to the user | `threads.length` over loaded pages |
| 5 | `MessageList.tsx:1133` `selectionCount`, `bulk-actions.ts:218` `countMatches` | exact match total | complete, but obtained by paging the whole result set through the browser; its own comment concedes the server should answer |
| 6 | `MessageList.tsx:1439` `pendingDeleteCount` | "about N" in the delete confirmation | frozen client page-through from #5 |
| 7 | `FlaggedList.tsx:108` `rows` | category + unread + attachment filter | loaded pages; `listAllThreads` accepts none of these params |
| 8 | `FlaggedList.tsx:130` `unreadCount` | unread count, shown to the user | loaded pages, no server fallback at all; grows on "load more" |
| 9 | `DailyBrief.tsx:197` `threadsData` | the brief's entire dataset | one non-paginated 50-row page, no "load more" |
| 10 | `brief.ts:136` `groupBriefSections` | groups rows into 7 category sections | that 50-row page |
| 11 | `ui/brief-section.tsx:66` `section.threads.length` | per-category size in the section header | that 50-row page — the header reads as a category total |
| 12 | `ui/brief-sections.tsx:130` `predicates`/`filtered` | a second, independent category+chip filter inside the kit | that 50-row page; duplicates #1 and #7 |
| 13 | `brief.ts:83` `mergeSearchRows` | dedupe + re-sort by `sentDate` | the union of two independently truncated windows (50 + 200), so "newest first" is not globally newest-first |
| 14 | `brief.ts:185` `matchesSearchTokens` | `from`/`hasAttachment`/`isUnread` filters | loaded rows, while the server accepts all three as params |
| 15 | `lib/spam-offer.ts:17` `spamOfferForResults` | per-mailbox group and count for the "N in Spam" offer | a truncated results window |
| 16 | `lib/drafts.ts:96` `groupDraftSections` | the "On the server" drafts section | MailboxPane's paginated, already-client-filtered `threads` |

### Legitimately client-side

| # | Location | Why it is correct |
|---|---|---|
| 17 | `useRescueCandidates.ts:22` | one bounded server query, complete response — the reference pattern |
| 18 | `useSemanticSearch.ts:80` | sends `category`, `hasAttachment`, `isRead`, `sentDateFrom/To` to the server; complete 20-row response |
| 19 | `MailboxPane.tsx:373` `dedupeThreadMessages` / `dropDeletedThreads` | cross-page dedupe by id and a belt-and-braces repeat of the server's `excludeDeleted` |
| 20 | `MailboxPane.tsx:731` `orderedIds` | keyboard adjacency over what is rendered |
| 21 | `MessageList.tsx:1117` `allLoadedSelected` | "all loaded" is the deliberate first selection tier |
| 22 | `starred-rows.ts:16` `dedupeByThread` | dedupe by `threadId`, documented |
| 23 | `brief.ts:165` `matchesBriefSearch` | matches snippets, which the server's subject+From match cannot |
| 24 | `DailyBrief.tsx:223` `unseenByAccount` / `totalUnseen` | sums server `unseenCount` over a complete mailbox list |
| 25 | `DailyBrief.tsx:166` `nonMuted` / `failedAccounts` | complete accounts response |
| 26 | `OutboxPane.tsx:199`, `MailSidebarAdapter.tsx:117` | complete, non-paginated outbox |
| 27 | `MailSidebarAdapter.tsx:88` `sortMailboxes` | presentation ordering over a complete list |
| 28 | `BriefPane.tsx:104`, `FlaggedPane.tsx:96` `selectedThread` | lookup within the window that was rendered |
| 29 | `display-category.ts:17` `toDisplayCategory` | per-row mapping, no window |
| 30 | `search-result.ts:109` `relatedSearchResults`, `MailboxPane.tsx:877`, `DailyBrief.tsx:341` | dedupe of semantic hits against the literal list. The exclusion set is the loaded pages, so a semantic hit whose thread sits on an unfetched page is not suppressed. Correct as scoped: the target is "what the user can see", which is the loaded window by definition. The visible consequence is bounded and cosmetic. |
| 31 | `useIntelligenceData.ts:253` `similar` | complete 5-row semantic response; self-exclusion shrinks it to 4, a limit nit rather than a boundary defect |

One item in the original report does not hold. The comment at `MailboxPane.tsx:172` says the spam rescue candidates are computed "over the loaded pages". That has not been true since `useRescueCandidates` began issuing its own server query; the comment is stale and is the only defect there.

Four independent copies of the same predicate table exist: `MailboxPane.INBOX_FILTER_PREDICATES:127`, `FlaggedList.FILTER_PREDICATES:45`, `ui/brief-sections.tsx:130` `briefFilterDefs`, and the token-based `brief.ts:185`. Once the predicates are server-side, all four go.

## Prior art this builds on

A prior investigation suggested that "SQL-only index objects and documented per-port search divergence are already the architecture here". Half of that holds.

SQL-only index objects are real and are precedent. `npm-scripts/sqlite-search-index.sql` is checked-in, out-of-schema DDL applied idempotently by the migrator, deliberately kept out of the drizzle schema. D1 does not need this mechanism — `category` is an ordinary column and takes an ordinary schema index — but the precedent for pushing a predicate into the storage engine is established.

The claim of documented *per-port* divergence does not hold in the sense it was offered. There is no DynamoDB port in this repository; `DrizzleThreadMessageRepository` is the only implementation of `IThreadMessageRepository`, and the DynamoDB composition is injected from outside via `setClient()`, which has no in-tree production caller. There is no `docs/`, `adr/` or `rfc/` directory, and the RFC numbers cited throughout the code refer to documents that live elsewhere. What exists is one code comment on `searchByMailboxWindow` stating that the SQL implementation abandons the DynamoDB window bound "but the DynamoDB name is kept for interface parity", and a bare port interface whose window semantics are documented only in the implementation and the OpenAPI description. So the divergence D3 governs has to be written down rather than cited — which is why this document exists in the repository rather than as a comment.

## What needs UX design

Three of the corrections have a user-visible surface and need a design answer before they are built. This document does not propose one. Under D8 each answer lands as a story before the app wiring that depends on it.

The result header when a count is absent (D4): what the header says for a filtered list whose count could not be computed. The question it answers is how the UI states "more than this page" without inventing a number.

The Flagged and brief section headers (#8, #11): today they show a number that means "how many of the newest 50", presented as a total. The question is whether those headers show a real total, a bounded figure with its bound, or no number.

The escalated-selection count (#5): the count arrives in one request instead of accumulating during a page-through, so the "Counting… N so far" state has nothing to count through. The question is what replaces it.

## FAQ

**Why not just raise the page size?** Because it moves the threshold instead of removing it. On this mailbox, `social` is 88 rows out of 14,187 — a filter over the newest page is empty at 50 rows and still empty at 500. Any fixed window has a category rare enough to fall outside it.

**Doesn't filtering on the server cost more reads?** It costs fewer. Filtering `social` in the browser requires reading all 14,187 rows in 284 pages, each with its own enrichment batch read, to find 88. A SQL `where` reads the 88.

**Why is `count` opt-in rather than always returned?** Because it is a second query over the whole match set. It is cheap on SQLite and expensive on a DynamoDB partition, and nothing should pay for it on a request that only needs a page.

**Does the exact count risk another runaway read?** Only if something couples it to keystrokes. The guard is that `count: true` is explicit per request, so a free-text search that changes on every character does not request a count on every character.

**Is a new endpoint needed?** No, and no new parameter either. `searchThreads` already accepts `category`, `continuationToken`, `count` and `limit`; the client simply never sends `category` to it. The only additive API change is the two response fields that report the read bound.

**Why keep both `listThreads` and `searchThreads`?** Because collapsing them is issue #197's decision, not this one's, and the bug does not need it. D5 narrows the gap — the filtered path now uses `searchThreads` — so whoever takes #197 has one fewer difference to reconcile.

**What happens to `uncategorized` mail?** It stays its own filterable value and its own section. It is a real category with a default on the entity, not a missing value, and D6 exists so that D1 cannot quietly fold it into `personal`.

**Why does the Storybook story have to land before the app change?** Because an empty list looks the same whether it is correct or broken, and this bug is exactly that. Reviewing the filtered-empty and filtered-with-results states next to each other, before any app code depends on either, is the only cheap way to tell them apart. It costs an extra hop per slice with a surface.

**Why isn't `dkimMismatch` moved on-row at the same time?** No shipped surface paginates it — the one caller is a bounded 500-row panel — and doing it would add a backfill over every existing message. D7 states the cost so the decision can be revisited when a surface needs it.

**Does this break the DynamoDB port?** It requires that port to implement two more predicates as a `FilterExpression` over an item it already reads, with a refill loop so a page is full. That port is not in this repository, so the requirement is stated in the contract rather than implemented here.

**Why is a stale comment listed as a finding?** Because it describes a defect that was already fixed, and the next person to read it will either re-fix what is not broken or trust it about a surface where it is wrong.
