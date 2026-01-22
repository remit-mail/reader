import "../enums/MailboxAttribute.tsp";
import "../enums/MailboxSpecialUse.tsp";
import "../enums/MessageFlag.tsp";

@doc("Represents an IMAP mailbox (folder). Contains IMAP-specific identifiers for message synchronization.")
model Mailbox {
  @doc("Primary identifier")
  mailboxId: string;

  @doc("Reference to the owning account")
  accountId: string;

  @doc("Reference to the containing namespace")
  namespaceId: string;

  @doc("Mailbox name (last component of path)")
  @minLength(1)
  name: string;

  @doc("Complete mailbox path including hierarchy")
  fullPath: string;

  @doc("Hierarchy delimiter character")
  @minLength(1)
  @maxLength(1)
  hierarchyDelimiter: string;

  @doc("32-bit value that changes when UIDs are invalidated (RFC 9051 Section 2.3.1.1)")
  @minValue(1)
  uidValidity: int64;

  @doc("Next UID to assign to a new message")
  @minValue(1)
  uidNext: int64;

  @doc("Total message count in mailbox")
  @minValue(0)
  messageCount: int32;

  @doc("Count of unseen messages")
  @minValue(0)
  unseenCount: int32;

  @doc("Count of messages marked for deletion")
  @minValue(0)
  deletedCount: int32;

  @doc("Total size of all messages in octets")
  @minValue(0)
  totalSize: int64;

  @doc("Reference to parent mailbox for hierarchy (null for root)")
  parentMailboxId?: string;

  @doc("Mailbox creation timestamp")
  createdAt: utcDateTime;

  @doc("Last modification timestamp")
  updatedAt: utcDateTime;
}

@doc("Mailbox attributes as defined in RFC 9051 Section 7.3.1")
model MailboxAttributeEntry {
  @doc("Primary identifier")
  mailboxAttributeId: string;

  @doc("Reference to parent mailbox")
  mailboxId: string;

  @doc("The attribute")
  attributeName: MailboxAttribute;
}

@doc("Mailbox special-use attributes indicating mailbox role (RFC 6154, RFC 9051 Section 7.3.1)")
model MailboxSpecialUseEntry {
  @doc("Primary identifier")
  mailboxSpecialUseId: string;

  @doc("Reference to parent mailbox")
  mailboxId: string;

  @doc("The special-use designation")
  specialUse: MailboxSpecialUse;
}

@doc("Defines which flags are valid for messages in this mailbox. Tracks permanent vs session-only flags.")
model MailboxFlag {
  @doc("Primary identifier")
  mailboxFlagId: string;

  @doc("Reference to parent mailbox")
  mailboxId: string;

  @doc("Flag value: system flag, common keyword, or custom keyword")
  flagName: MessageFlagValue;

  @doc("True if flag persists across sessions (PERMANENTFLAGS)")
  isPermanent: boolean;
}

@doc("Tracks mailbox subscriptions per account (SUBSCRIBE/UNSUBSCRIBE commands)")
model MailboxSubscription {
  @doc("Primary identifier")
  subscriptionId: string;

  @doc("Reference to the subscribing account")
  accountId: string;

  @doc("Reference to the subscribed mailbox")
  mailboxId: string;

  @doc("When the subscription was created")
  subscribedAt: utcDateTime;
}
