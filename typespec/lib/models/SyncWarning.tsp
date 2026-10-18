import "typespec-electrodb-emitter";

import "../enums/SyncWarningStage.tsp";

namespace RemitImap;

@doc("""
  A message that failed to sync and was not set aside (issue #1400).
  
  A warning only observes: it never filters a uid out of a round or moves a
  cursor. Each failure raises `attempts` on one row, and the row is deleted
  when the message later syncs. Whether a row is retrying or has given up is
  derived from `stage` and `attempts`, never stored.
  """)
@entity("syncWarning", "remit")
@doc("Get one warning by identity. `syncWarningId` is derived from (accountId, mailboxId, uidValidity, uid, stage), so a repeated failure raises `attempts` on the same row.")
@index(
  "SyncWarning",
  {
    pk: [SyncWarning.syncWarningId],
    sk: [],
  }
)
@doc("Every warning for one user, newest first.")
@index(
  "byAccountConfigId",
  {
    index: "gsi1",
    pk: [SyncWarning.accountConfigId],
    sk: [SyncWarning.createdAt],
  }
)
@doc("Every warning in one mailbox — the set a sync round settles, and the rows a mailbox deletion takes.")
@index(
  "byMailboxId",
  {
    index: "gsi2",
    pk: [SyncWarning.mailboxId],
    sk: [],
  }
)
model SyncWarning {
  @doc("Deterministic v5 identity derived from accountId, mailboxId, uidValidity, uid and stage.")
  @visibility(Lifecycle.Read)
  syncWarningId: UUID;

  @doc("Owning account configuration — the user.")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Mail account the message arrived on.")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Mailbox the message arrived in.")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("UIDVALIDITY of the mailbox when the message failed. Only uidValidity + uid names a message forever (RFC 9051 2.3.1.1).")
  @visibility(Lifecycle.Read)
  uidValidity: int64;

  @doc("The IMAP uid that failed.")
  @visibility(Lifecycle.Read)
  uid: int64;

  @doc("The sync step the message failed at.")
  @visibility(Lifecycle.Read)
  stage: SyncWarningStage;

  @doc("Rounds that failed on this message so far.")
  @visibility(Lifecycle.Read)
  attempts: int32;

  @doc("Epoch millis of the first failure.")
  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;
}
