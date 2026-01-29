import "typespec-electrodb-emitter";

import "../enums/MailboxAttribute.tsp";
import "../enums/MailboxSpecialUse.tsp";
import "../enums/MailboxSyncStatus.tsp";
import "../enums/MessageFlag.tsp";
import "../enums/NamespaceType.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Represents an IMAP mailbox (folder). Contains IMAP-specific identifiers for message synchronization.")
@entity("mailbox", "remit")
// Used for atomical operations: batch get/put/delete
@index(
  "Mailbox",
  {
    pk: [Mailbox.mailboxId],
    sk: [],
  }
)
// List all mailboxes for account
@index(
  "byAccountId",
  {
    collection: "account",
    index: "gsi0",
    pk: [Mailbox.accountId],
    sk: [],
  }
)
// Collection to retrieve all
// Mailbox data
@index(
  "byMailboxId",
  {
    collection: "mailbox",
    index: "gsi1",
    pk: [Mailbox.mailboxId],
    sk: [],
  }
)
model Mailbox {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("Reference to the owning account")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Namespace type: personal, other_users, or shared")
  @visibility(Lifecycle.Create, Lifecycle.Read)
  namespaceType: NamespaceType = NamespaceType.Personal;

  @doc("Namespace prefix (e.g., '', '~', '#shared/')")
  @visibility(Lifecycle.Read)
  namespacePrefix: string;

  @doc("Character used to separate hierarchy levels (typically '/' or '.')")
  @visibility(Lifecycle.Read)
  @minLength(1)
  @maxLength(1)
  hierarchyDelimiter: string;

  @doc("Complete mailbox path including hierarchy")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  @minLength(1)
  fullPath: String512;

  @doc("32-bit value that changes when UIDs are invalidated (RFC 9051 Section 2.3.1.1)")
  @visibility(Lifecycle.Read)
  @minValue(1)
  uidValidity: int64;

  @doc("Next UID to assign to a new message")
  @visibility(Lifecycle.Read)
  @minValue(1)
  uidNext: int64;

  @doc("Highest modification sequence number (CONDSTORE). Used to detect mailbox changes efficiently.")
  @visibility(Lifecycle.Read)
  @minValue(0)
  highestModseq: int64;

  @doc("Total message count in mailbox")
  @visibility(Lifecycle.Read)
  @minValue(0)
  messageCount: int32;

  @doc("Count of unseen messages")
  @visibility(Lifecycle.Read)
  @minValue(0)
  unseenCount: int32;

  @doc("Count of messages marked for deletion")
  @visibility(Lifecycle.Read)
  @minValue(0)
  deletedCount: int32;

  @doc("Total size of all messages in octets")
  @visibility(Lifecycle.Read)
  @minValue(0)
  totalSize: int64;

  @doc("The lowest UID that has been successfully synced (tracks downward progress)")
  @visibility(Lifecycle.Read)
  lastSyncUid: int64;

  @doc("The highest UID ever seen/synced (used to detect new messages)")
  @visibility(Lifecycle.Read)
  highWaterMarkUid: int64;

  @doc("Timestamp of the last successful message sync")
  @visibility(Lifecycle.Read)
  lastMessageSyncAt: int64;

  @doc("Reference to parent mailbox for hierarchy (null for root)")
  @visibility(Lifecycle.Read)
  parentMailboxId?: string;

  @doc("Sync status for mailbox operations (create, rename, delete)")
  @visibility(Lifecycle.Read)
  syncStatus?: MailboxSyncStatus;

  @doc("Previous path before rename (used during RENAME sync)")
  @visibility(Lifecycle.Read)
  oldPath?: String512;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Mailbox attributes as defined in RFC 9051 Section 7.3.1")
@entity("mailboxAttributeEntry", "remit")
@index(
  "MailboxAttributeEntry",
  {
    pk: [MailboxAttributeEntry.mailboxAttributeId],
    sk: [],
  }
)
@index(
  "byMailboxId",
  {
    collection: "mailbox",
    index: "gsi1",
    pk: [MailboxAttributeEntry.mailboxId],
    sk: [MailboxAttributeEntry.mailboxAttributeId],
  }
)
model MailboxAttributeEntry {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  mailboxAttributeId: UUID;

  @doc("Reference to parent mailbox")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("The attribute")
  @visibility(Lifecycle.Read)
  attributeName: MailboxAttribute;
}

@doc("Mailbox special-use attributes indicating mailbox role (RFC 6154, RFC 9051 Section 7.3.1)")
@entity("mailboxSpecialUseEntry", "remit")
@index(
  "MailboxSpecialUseEntry",
  {
    pk: [MailboxSpecialUseEntry.mailboxSpecialUseId],
    sk: [],
  }
)
@index(
  "byMailboxId",
  {
    collection: "mailbox",
    index: "gsi1",
    pk: [MailboxSpecialUseEntry.mailboxId],
    sk: [MailboxSpecialUseEntry.mailboxSpecialUseId],
  }
)
model MailboxSpecialUseEntry {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  mailboxSpecialUseId: UUID;

  @doc("Reference to parent mailbox")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("The special-use designation")
  @visibility(Lifecycle.Read)
  specialUse: MailboxSpecialUse;
}

@doc("Defines which flags are valid for messages in this mailbox. Tracks permanent vs session-only flags.")
@entity("mailboxFlag", "remit")
@index(
  "MailboxFlag",
  {
    pk: [MailboxFlag.mailboxFlagId],
    sk: [],
  }
)
@index(
  "byMailboxId",
  {
    collection: "mailbox",
    index: "gsi1",
    pk: [MailboxFlag.mailboxId],
    sk: [MailboxFlag.mailboxFlagId],
  }
)
model MailboxFlag {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  mailboxFlagId: UUID;

  @doc("Reference to parent mailbox")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("Flag value: system flag, common keyword, or custom keyword")
  @visibility(Lifecycle.Read)
  flagName: MessageFlagValue;

  @doc("True if flag persists across sessions (PERMANENTFLAGS)")
  @visibility(Lifecycle.Read)
  isPermanent: boolean;
}

// ============================================
// API Input Models
// ============================================

@doc("Input for creating a new mailbox")
model CreateMailboxInput is Create<Mailbox>;

@doc("Input for renaming a mailbox")
model RenameMailboxInput is Update<Mailbox>;

// ============================================
// API Response Models
// ============================================

@doc("Mailbox item returned by list/get operations")
model MailboxResponse
  is PickProperties<
    Mailbox,

      | "mailboxId"
      | "accountId"
      | "fullPath"
      | "namespaceType"
      | "namespacePrefix"
      | "hierarchyDelimiter"
      | "messageCount"
      | "unseenCount"
      | "deletedCount"
      | "createdAt"
      | "updatedAt"
  >;
