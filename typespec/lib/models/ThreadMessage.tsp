import "typespec-electrodb-emitter";

import "../enums/StarColor.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Normalized message-to-thread mapping. Source of truth for thread reconstruction.")
@entity("threadMessage", "remit")
@index(
  "ThreadMessage",
  {
    pk: [ThreadMessage.accountConfigId],
    sk: [ThreadMessage.threadMessageId],
  }
)
// Shares "threadDetails" collection with Thread and ThreadParticipant
@index(
  "byThreadId",
  {
    collection: "threadDetails",
    index: "gsi0",
    pk: [ThreadMessage.threadId],
    sk: [ThreadMessage.internalDate],
  }
)
@index(
  "byMessageIdHeader",
  {
    index: "gsi1",
    pk: [ThreadMessage.accountConfigId, ThreadMessage.messageIdHeader],
    sk: [],
  }
)
@index(
  "byMailboxId",
  {
    index: "gsi2",
    pk: [ThreadMessage.mailboxId],
    sk: [ThreadMessage.internalDate],
  }
)
model ThreadMessage {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  threadMessageId: UUID;

  @doc("Reference to parent thread")
  @visibility(Lifecycle.Read)
  threadId: UUID;

  @doc("Reference to Message entity")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Mailbox containing this message")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("IMAP UID within mailbox")
  @visibility(Lifecycle.Read)
  @minValue(1)
  uid: int64;

  @doc("RFC 2822 Message-ID header value (without angle brackets)")
  @visibility(Lifecycle.Read)
  messageIdHeader?: string;

  @doc("In-Reply-To header value (without angle brackets)")
  @visibility(Lifecycle.Read)
  inReplyTo?: string;

  @doc("Position in References chain (0 = root)")
  @visibility(Lifecycle.Read)
  @minValue(0)
  referenceOrder: int32;

  @doc("Sender email address (denormalized for display)")
  @visibility(Lifecycle.Read)
  fromEmail?: string;

  @doc("Sender display name (denormalized for display)")
  @visibility(Lifecycle.Read)
  fromName?: string;

  @doc("Message subject")
  @visibility(Lifecycle.Read)
  subject?: string;

  @doc("IMAP INTERNALDATE timestamp")
  @visibility(Lifecycle.Read)
  internalDate: int64;

  @doc("Message has \\Seen flag")
  @visibility(Lifecycle.Read)
  isRead: boolean;

  @doc("Message has attachments")
  @visibility(Lifecycle.Read)
  hasAttachment: boolean;

  @doc("Message-level star color")
  @visibility(Lifecycle.Read)
  star?: StarColor;

  @doc("Preview text (~256 chars)")
  @visibility(Lifecycle.Read)
  snippet?: String256;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
