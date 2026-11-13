import "typespec-electrodb-emitter";

namespace RemitImap;

@doc("The folder a label maps to in one account, keyed by labelId + accountId (RFC 040).")
@entity("labelMailbox", "remit")
@index(
  "LabelMailbox",
  {
    pk: [LabelMailbox.labelMailboxId],
    sk: [],
  }
)
@index(
  "byAccountId",
  {
    index: "gsi0",
    pk: [LabelMailbox.accountId],
    sk: [LabelMailbox.labelId],
  }
)
@index(
  "byLabelId",
  {
    index: "gsi1",
    pk: [LabelMailbox.labelId],
    sk: [LabelMailbox.accountId],
  }
)
model LabelMailbox {
  @doc("Deterministic id derived from labelId + accountId")
  @visibility(Lifecycle.Read)
  labelMailboxId: UUID;

  @doc("Label the folder belongs to")
  @visibility(Lifecycle.Read)
  labelId: UUID;

  @doc("Account that owns the folder")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("The label's folder in that account")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
