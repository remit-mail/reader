# IMAP mutation rules

An IMAP mutation is any operation that changes state on the remote mail server: folder create, rename, delete; message move, copy, delete, flag; append. The remote server is the source of truth; the local database is a projection of it. A mutation is therefore not done when the local row is written — it is done when the server has confirmed it.

## R1. Every IMAP mutation uses the mutator pattern

A mutation is a record-pending state change, settled by confirmation:

1. Write the local record with a pending marker (`syncStatus: pending`, or the operation's equivalent).
2. Enqueue the remote operation.
3. The worker performs it and writes back the settled state (`synced`, with the server's canonical values — e.g. the normalized path) or `failed`.

No fire-and-forget writes to the server. No local state that claims server truth before confirmation. Reconciliation treats pending records as in-flight, never as absent — a reconcile sweep must not delete or rebuild a record whose mutation has not settled.

A mutation may settle by deleting its own record: a send APPENDs the message to Sent and then drops the outbox row, so the delete is the confirmation. Where that is the design, the record's absence is a settled state and every reader of it treats a 404 as the confirmed outcome, not a failure — but only where the flow says so, because absence otherwise means a pending record that went missing.

## R2. Every dependent operation decides: wait or reconcile — explicitly

Any operation that reads or references a record with a pending mutation must choose one of two models, and the choice is a design decision stated in the PR or design doc, never an implicit default:

- **Wait**: block until the mutation settles, then bind to the confirmed record. Failure surfaces before the dependent write exists.
- **Reconcile**: bind optimistically and design the reconciliation path that repairs the reference when confirmation changes the record. The repair path is part of the change, not a follow-up.

Default guidance: dependent writes wait (a filter binding a just-created folder, a move into it — cheap to block, and cross-queue ordering between mailbox and message queues is not guaranteed). Independent reads may show pending state, honestly labeled.

## R3. Every placement transition is a conditional write, and the placement fields are the lock

A message's placement is the four fields that say where the message is and what is happening to it: `status`, `syncStatus`, `mailboxId`, `uid`. Every write of any of them is a **transition** — one `UPDATE … WHERE messageId = ? AND <expected placement> RETURNING`, issued through `IMessageRepository.transitionPlacement`. No lock row and no version column: a second mechanism that can disagree with the fields every reader already consults is worse than the fields themselves. This generalizes `folder-rename-and-delete.md` D3 from folders to messages.

The predicate names the state the caller decided against, not merely the row's id. A mutator that read a row at `active` / INBOX / uid 42 and decided to move it writes `WHERE status = 'active' AND mailboxId = <INBOX> AND uid = 42`. What the caller did not read, it does not predicate on.

**A failed predicate means someone else won.** The transition returns nothing. The loser never blind-retries and never writes anyway: it re-reads the row and re-decides against what it now says — skip, refuse with 409, take a different branch. Losing is an ordinary outcome, logged as one, not an error.

The lanes are genuinely concurrent, which is what makes this load-bearing. User moves, deletes and Empty Trash ride a FIFO queue grouped by `accountId`, so they are ordered against each other; `PLACEMENT_MOVE_PUSH` rides a standard queue and is ordered against nothing (`deploy/vps/queues.json`). Read-then-filter-then-write over a snapshot cannot be made safe by queue ordering, and a comment claiming otherwise is wrong.

### The placement states

`status` and `syncStatus` are read as a pair. Neither alone is a state.

| state | pair | meaning |
| --- | --- | --- |
| settled | `active` + `synced` or `pending` | a faithful projection; no mutation outstanding |
| moving | `moving` + `synced` or `pending` | a move or copy is in flight |
| deleting | `deleting` + `synced` or `pending` | a delete or Empty Trash is in flight |
| retrying | `moving` or `deleting`, + `failed` | an attempt failed; a redelivery is coming |
| abandoned | `active` + `abandoned`, plus `abandonedMutation` | the named mutation gave up, and the row was put back on a placement the server holds |

`syncStatus: pending` on an `active` row means nothing: an ordinary inbound sync writes it and nothing later promotes it. `failed` is a transient attempt marker — the move, delete and copy handlers write it and re-throw for redelivery — so it never means give-up on its own. Give-up is `abandoned`, written only after the row has been restored to a placement the server confirmed, and only by a caller holding the server's own answer rather than an inference.

**A give-up names the mutation it gave up on.** `abandonedMutation` carries it, and is read only while `syncStatus` is `abandoned` — outside that gate it is `none` and says nothing, the way `originalUid` says nothing once a placement has settled. It exists because the hand-back erases the evidence: restoring the row sets `status` back to `active`, and `status` was the only field naming the mutation that was outstanding. Without it a surface can see that something was abandoned and not what, which is how a move that handed back came to be reported to the user as a failed delete, under a button that deleted the message.

Two give-ups deliberately carry no marker. `flag-push` and `placement-move-push` never write a placement at all — their give-up lives on their own marker rows and in an operator alert — and Remit's own classification filing is not a mutation the user asked for, so a per-message treatment would report a failure against an intent nobody formed.

Two consequences every reader gets from this:

- A dependent mutation blocked on an unsettled placement waits on any in-flight or retrying state and refuses only `abandoned`. A mid-retry row is about to succeed; that is what the settle ceiling is for.
- A sighting from the server repairs any `active` row, whatever its `syncStatus`. `active` is exactly the set nothing else is coming for.

## FAQ

**Why not always wait?** Standalone mutations with no dependent write (creating a folder from settings) gain nothing from blocking; optimistic display with a pending marker is honest and snappy.

**Why not always reconcile?** Reconciliation is the more machinery: every reference to the record needs a repair path, and each missed one is a dangling-reference bug. Waiting costs seconds once; reconciliation costs correctness forever after.

**What happens on wait timeout?** The dependent write is not made. The pending record remains and settles on its own; the user is told the dependency failed and can retry against the same record — retry must not create a duplicate.

**Does this apply to reads?** No. Reads show the projection, including pending state. The rules govern mutations and writes that depend on them.

**What does a client see when it loses a placement transition?** 409, naming the mutation already outstanding on the message. The row exists — the caller read it — so a lost compare-and-set is a conflict, not a 404.

**Where did this come from?** A filter bound to a folder row while its create was still in flight; the server normalized the path, reconcile replaced the row, and the filter pointed at a deleted record (fixed across v0.2.4). Both failure halves violated these rules: the reconcile treated a pending row as absent (R1), and the filter bound without a wait-or-reconcile decision (R2).
