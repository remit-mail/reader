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

## FAQ

**Why not always wait?** Standalone mutations with no dependent write (creating a folder from settings) gain nothing from blocking; optimistic display with a pending marker is honest and snappy.

**Why not always reconcile?** Reconciliation is the more machinery: every reference to the record needs a repair path, and each missed one is a dangling-reference bug. Waiting costs seconds once; reconciliation costs correctness forever after.

**What happens on wait timeout?** The dependent write is not made. The pending record remains and settles on its own; the user is told the dependency failed and can retry against the same record — retry must not create a duplicate.

**Does this apply to reads?** No. Reads show the projection, including pending state. The rules govern mutations and writes that depend on them.

**Where did this come from?** A filter bound to a folder row while its create was still in flight; the server normalized the path, reconcile replaced the row, and the filter pointed at a deleted record (fixed across v0.2.4). Both failure halves violated these rules: the reconcile treated a pending row as absent (R1), and the filter bound without a wait-or-reconcile decision (R2).
