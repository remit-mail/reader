import "typespec-electrodb-emitter";

import "../enums/MessageCategory.tsp";
import "../enums/SenderTrust.tsp";
import "../enums/StarColor.tsp";
import "../scalars/string.tsp";
import "./Message.tsp";

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
// Collection "threadDetails" on GSI0 - can be extended with ThreadAggregates later
@index(
  "byThreadId",
  {
    collection: "threadDetails",
    index: "gsi0",
    pk: [ThreadMessage.threadId],
    sk: [ThreadMessage.sentDate],
  }
)
@index(
  "byMessageId",
  {
    index: "gsi1",
    pk: [ThreadMessage.messageId],
    sk: [],
  }
)
// GSI2: Filter/count unread messages (moved from LSI for independent scaling)
@index(
  "byUnread",
  {
    index: "gsi2",
    pk: [ThreadMessage.accountConfigId],
    sk: [ThreadMessage.isRead, ThreadMessage.sentDate],
  }
)
@index(
  "byDate",
  {
    index: "lsi1",
    pk: [ThreadMessage.accountConfigId],
    sk: [ThreadMessage.sentDate],
  }
)
@index(
  "byMailboxId",
  {
    index: "lsi2",
    pk: [ThreadMessage.accountConfigId],
    sk: [ThreadMessage.mailboxId, ThreadMessage.sentDate],
  }
)
@index(
  "byAttachment",
  {
    index: "lsi3",
    pk: [ThreadMessage.accountConfigId],
    sk: [ThreadMessage.hasAttachment, ThreadMessage.sentDate],
  }
)
@index(
  "byStarred",
  {
    index: "lsi4",
    pk: [ThreadMessage.accountConfigId],
    sk: [ThreadMessage.hasStars, ThreadMessage.sentDate],
  }
)
@index(
  "byMailboxAndReadStatus",
  {
    index: "lsi5",
    pk: [ThreadMessage.accountConfigId],
    sk: [ThreadMessage.mailboxId, ThreadMessage.isRead, ThreadMessage.sentDate],
  }
)
// NOTE: A "byDeletedStatus" LSI6 was removed here (see #516) — it was never
// provisioned (the table only has lsi1–lsi5) and DynamoDB's 5-LSI hard limit
// means it can never be added as an LSI. If a trash-view access pattern is
// needed in the future, implement it as a GSI (e.g. gsi3), which can be
// added to a live table without a destructive replacement.
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

  @doc("IMAP INTERNALDATE timestamp (when server received the message)")
  @visibility(Lifecycle.Read)
  internalDate: int64;

  @doc("Envelope date from message headers (when message was sent)")
  @visibility(Lifecycle.Read)
  sentDate: int64;

  @doc("Message has \\Seen flag")
  @visibility(Lifecycle.Read)
  isRead: boolean;

  @doc("Message has attachments")
  @visibility(Lifecycle.Read)
  hasAttachment: boolean;

  @doc("Message-level star color. Defaults to `None` (no star) — the absent state is a named sentinel value, never an empty field. `hasStars` carries the boolean the byStarred index filters on.")
  @visibility(Lifecycle.Read)
  star: StarColor = StarColor.None;

  @doc("True if message is starred (for index filtering)")
  @visibility(Lifecycle.Read)
  hasStars: boolean;

  @doc("True if message is in Trash or deleted (for UI filtering)")
  @visibility(Lifecycle.Read)
  isDeleted: boolean;

  @doc("Preview text (~256 chars)")
  @visibility(Lifecycle.Read)
  snippet?: String256;

  @doc("Header-derived category, denormalized from the underlying Message. Defaults to `uncategorized` at metadata-sync and is set to the classified value at body-sync — that pending state is a named value, not absence.")
  @visibility(Lifecycle.Read)
  category: MessageCategory = MessageCategory.uncategorized;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

// ============================================
// API Response Models
// ============================================

@doc("Thread message item returned by list/search operations. `category` and `senderTrust` are attached at read time via batch-fetch so the inbox row can render badges without a per-row round trip.")
model ThreadMessageResponse {
  ...PickProperties<
    ThreadMessage,

      | "threadMessageId"
      | "threadId"
      | "messageId"
      | "accountConfigId"
      | "mailboxId"
      | "subject"
      | "fromEmail"
      | "fromName"
      | "sentDate"
      | "isRead"
      | "hasAttachment"
      | "hasStars"
      | "star"
      | "isDeleted"
      | "snippet"
      | "createdAt"
      | "updatedAt"
  >;

  @doc("Header-derived category for the message (from the underlying Message). Absent for messages synced before classification rolled out — clients should treat this as `personal`.")
  category?: MessageCategory;

  @doc("Trust level for the From address, derived from AddressFlags at read time. Defaults to `unknown` when no Address row resolves.")
  senderTrust: SenderTrust;

  @doc("Structured sender-authenticity signal derived from DKIM headers at classification time (from the underlying Message). Absent for messages classified before this field was introduced — absence means no signal.")
  authenticity?: MessageAuthenticity;

  @doc("Account identifier attached at read time via a mailboxId→accountId map. Present on rows returned by `GET /threads`; absent on rows from per-mailbox endpoints (clients can resolve from the mailbox cache).")
  accountId?: UUID;

  @doc("Present only when Remit auto-moved this message on body-sync. Absent means the message was not auto-moved by Remit.")
  autoMoved?: AutoMovedInfo;
}

@doc("""
  Aggregate response for `searchThreads`. Carries the matching rows (`items`), a
  pagination `continuationToken`, and an optional `count` of matches within the
  server-capped window. `items` is omitted when `results=false` (count-only);
  `count` is present only when `count=true`. Thread-specific so the shared
  `ResultList<T>` (7 endpoints) stays untouched.
  """)
model ThreadSearchResponse {
  @doc("Matching thread rows for this page. Omitted when `results=false` (count-only mode).")
  items?: ThreadMessageResponse[];

  @doc("Pass to the next call to fetch the next page; absent when the window is exhausted.")
  @continuationToken
  continuationToken?: String800;

  @doc("Number of matches within the server-capped window. Present only when `count=true`.")
  count?: int32;
}
