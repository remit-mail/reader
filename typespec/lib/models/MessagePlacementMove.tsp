import "typespec-electrodb-emitter";

import "../enums/MessagePlacementMoveState.tsp";

namespace RemitImap;

@doc("""
  Pending-move marker for a Remit-driven placement move (issue #1271, epic
  #1281). Written in the SAME local step that moves a Message's `mailboxId` to
  its destination — the marker's existence IS the record that the move still
  owes IMAP a push. A marker clears ONLY on a confirmed IMAP move; it is never
  cleared on attempt. References `messageId`, never a UID — UIDs are resolved
  fresh at push time (epic invariant 1), so the marker survives unrelated
  cursor churn on the mailbox.
  
  At most one pending placement move exists per message: a later placement
  decision replaces the marker (`put`, not `create`), matching "later intent
  wins locally" (epic FAQ). Scoped to classification-driven placement moves
  only — user-initiated moves/deletes/copies keep using the existing
  `MessageMoveService` machinery untouched.
  """)
@entity("messagePlacementMove", "remit")
@index(
  "MessagePlacementMove",
  {
    pk: [MessagePlacementMove.messageId],
    sk: [],
  }
)
@doc("List every pending placement move for an account — used ONLY to adjust folder message counts at read time (epic #1281 invariant 4: a prediction, never persisted). Pending markers are expected to be few and short-lived.")
@index(
  "byAccountId",
  {
    index: "gsi0",
    pk: [MessagePlacementMove.accountId],
    sk: [MessagePlacementMove.messageId],
  }
)
model MessagePlacementMove {
  @doc("The message this pending move applies to (our internal id, never a UID).")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Account the message belongs to.")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Account config id, for thread/address lookups.")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Mailbox the message was in when the move was decided. The reconciler opens this mailbox to push the move.")
  @visibility(Lifecycle.Read)
  sourceMailboxId: UUID;

  @doc("Mailbox the message was moved to locally. Cleared (marker deleted) once IMAP confirms the move landed here.")
  @visibility(Lifecycle.Read)
  destinationMailboxId: UUID;

  @doc("Explicit state engine (pending -> queued -> processing -> processed). Recovery keys off this field, not control-flow inference — see the enum's own doc.")
  @visibility(Lifecycle.Read)
  state: MessagePlacementMoveState = MessagePlacementMoveState.pending;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
