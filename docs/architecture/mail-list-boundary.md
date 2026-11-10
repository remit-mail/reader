# The mail list is a server-side query

## What the boundary is

A mail list is the result of a query the server runs. The server decides which rows are in the list, in what order they appear, how many there are in total, and where the next page starts. The client asks for a page and renders it.

The test for whether a derivation is on the wrong side of this boundary is one question: **does its result change when another page loads?** If yes, it is a server concern and a client-side implementation of it is a defect. A filter, a count, a sort, or a grouping computed over "the pages fetched so far" is wrong at every moment except the one where every page happens to be loaded.

## What the boundary is not

It is not a rule that the client may never compute anything over rows.

Three kinds of client-side derivation are correct. First, derivations over a **complete** server response — summing `unseenCount` across a full list of mailboxes, filtering a non-paginated outbox. The window is the whole set, so no page load can change the answer. Second, derivations whose subject **is** the loaded window — which rows are selected, which row the keyboard moves to next, whether every visible row is selected. Third, **per-row presentation** — mapping a category value to a label, formatting a date. These have no window at all.

## Decisions

### D2 — the port seam promises filtered, ordered, paginated rows; each port implements it natively

Filtering, ordering and counting live behind `IThreadMessageRepository`, not in a shared layer that filters the rows a port returns — that arrangement is how a filtered page came back empty with a continuation token attached. A port that can answer a predicate in the storage engine does so. A port that cannot must still return a full page of matches, which for DynamoDB means a `FilterExpression` with a refill loop.

Two ports may differ in what an answer costs. They agree on what it means.

### D6 — `uncategorized` remains a filterable value

`ThreadMessage.category` defaults to `uncategorized`, a named value rather than absence. A server-side category filter must be able to express it, and the client keeps it in its own section rather than folding it into `personal` (issue #45).

### D7 — `dkimMismatch` and `senderTrust` stay off-row

Both could be denormalized onto `thread_message` the way `category` was. `dkimMismatch` is the better candidate, because `MessageItem.authenticity` is immutable once synced, whereas `senderTrust` derives from mutable VIP flags and would fan out a write to every row from a sender on each change. Neither is, because the only surface that filters on them is a bounded single-query panel, not a paginated list, and denormalizing costs a schema change plus a backfill over every message. Revisit when a paginated surface needs them.
