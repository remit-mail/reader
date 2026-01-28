import "typespec-electrodb-emitter";

namespace RemitImap;

@doc("Distributed lock for mailbox sync operations. Prevents concurrent sync operations on the same mailbox.")
@entity("mailboxLock", "remit")
// Primary key: get/delete lock by mailboxId + eventName
@index(
  "MailboxLock",
  {
    pk: [MailboxLock.mailboxId],
    sk: [MailboxLock.eventName],
  }
)
// Part of mailbox collection for account deletion cleanup
@index(
  "byAccountId",
  {
    collection: "mailbox",
    index: "gsi1",
    pk: [MailboxLock.accountId],
    sk: [MailboxLock.mailboxId, MailboxLock.eventName],
  }
)
// List all locks sorted by acquiredAt for monitoring
@index(
  "allLocks",
  {
    collection: "locks",
    index: "gsi2",
    pk: [],
    sk: [MailboxLock.acquiredAt],
  }
)
model MailboxLock {
  @doc("The mailbox being locked (same as Mailbox.mailboxId)")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("Event type this lock applies to (e.g., 'SYNC_MESSAGES')")
  @visibility(Lifecycle.Read)
  eventName: string;

  @doc("Account that owns this mailbox")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Unique identifier for the lock holder (e.g., Lambda request ID)")
  @visibility(Lifecycle.Read)
  lockId: UUID;

  @doc("Timestamp when lock was acquired (epoch ms)")
  @visibility(Lifecycle.Read)
  acquiredAt: int64;

  @doc("Human-readable context (e.g., 'sync-messages handler')")
  @visibility(Lifecycle.Read)
  lockedBy: string;

  @doc("TTL for DynamoDB automatic deletion (epoch seconds)")
  @visibility(Lifecycle.Read)
  ttl: int64;
}
