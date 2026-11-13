import "typespec-electrodb-emitter";

namespace RemitImap;

@doc("""
  The folder a label maps to in one account (RFC 040): the child of that
  account's remit root whose case-folded name is the label's normalizedName.
  Keyed by a deterministic id derived from `labelId` + `accountId`, so a label
  holds at most one folder per account and a single `get` resolves it. The
  folder's own row carries its state.
  """)
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
