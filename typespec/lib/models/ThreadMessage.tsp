import "@kattebak/typespec-drizzle-orm-generator";
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
//
// The filtered-mailbox read path (a category predicate inside the keyset
// window) is served by a SQL-only index instead: @Drizzle.indexDef emits a
// drizzle index and nothing on the DynamoDB side, because the drizzle generator
// holds it in its own state key and the electrodb emitter never reads it.
// Referenced qualified rather than through `using Drizzle;`: this file's
// @createdAt/@updatedAt are the electrodb emitter's and its @minValue is
// TypeSpec's own, and the Drizzle namespace declares all three.
//
// isDeleted sits before sentDate because every read hardcodes excludeDeleted, so
// it is an equality that does not break the range and lets a filtered count be
// answered from the index alone.
@Drizzle.indexDef(
  "tm_by_mailbox_category_date",
  [
    ThreadMessage.accountConfigId,
    ThreadMessage.mailboxId,
    ThreadMessage.category,
    ThreadMessage.isDeleted,
    ThreadMessage.sentDate
  ]
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

  @doc("Normalized `List-Id` header value (bracketed identifier, case-folded), denormalized at body-sync so the back-apply corpus projection can match a `ListId` clause vector-free. Absent when the message carries no `List-Id` header or was body-synced before this field existed.")
  @visibility(Lifecycle.Read)
  listId?: String256;

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

@doc("Thread message item returned by list/search operations. `senderTrust` is attached at read time via batch-fetch so the inbox row can render its badge without a per-row round trip. `category` is served from the ThreadMessage row itself, which is also the row the category filter matches, so the badge and the filter cannot disagree.")
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

  @doc("Header-derived category for the message, served from the ThreadMessage row. Always present: the column is NOT NULL with an `uncategorized` default, and `uncategorized` is a named value for the not-yet-classified state, never a stand-in for `personal` (issue #45).")
  category: MessageCategory;

  @doc("Trust level for the From address, derived from AddressFlags at read time. Defaults to `unknown` when no Address row resolves.")
  senderTrust: SenderTrust;

  @doc("Whether the From address is muted, derived from AddressFlags at read time. Defaults to `false` when no Address row resolves. Muting hides the sender from the daily brief; it does not affect mailbox listings.")
  muted: boolean;

  @doc("Structured sender-authenticity signal derived from DKIM headers at classification time (from the underlying Message). Absent for messages classified before this field was introduced — absence means no signal.")
  authenticity?: MessageAuthenticity;

  @doc("Account identifier attached at read time via a mailboxId→accountId map. Present on rows returned by `GET /threads`; absent on rows from per-mailbox endpoints (clients can resolve from the mailbox cache).")
  accountId?: UUID;

  @doc("Present only when Remit auto-moved this message on body-sync. Absent means the message was not auto-moved by Remit.")
  autoMoved?: AutoMovedInfo;

  @doc("Labels applied to this message — filter-, organize-, and manually-applied alike (issue #26). Absent/empty means no label is applied.")
  labels?: LabelSummaryResponse[];

  @doc("Present when the user reported this message as spam and the report has not been undone, projected from the underlying Message row. Backs the \"Reported as spam · Undo\" affordance in list views.")
  spamReport?: MessageSpamReport;
}

@doc("""
  Aggregate response for the filterable thread listings — `searchThreads` and
  `listAllThreads`. Carries the matching rows (`items`), a pagination
  `continuationToken`, and an optional `count` of what the query matches.
  `items` is omitted when `results=false` (count-only); `count` is present only
  when `count=true`. Thread-specific so the shared `ResultList<T>` (7 endpoints)
  stays untouched.

  `listAllThreads` answers with this model rather than `ResultList<T>` for that
  same reason: it needs the count field and the shared model cannot carry one.
  One model over both operations rather than a second of the same shape, so a
  client reading a filtered thread listing reads one response type whether the
  listing is scoped to a mailbox or spans every account.
  """)
model ThreadSearchResponse {
  @doc("Matching thread rows for this page. Omitted when `results=false` (count-only mode).")
  items?: ThreadMessageResponse[];

  @doc("Pass to the next call to fetch the next page; absent when the window is exhausted.")
  @continuationToken
  continuationToken?: String800;

  @doc("""
    How much the query matches, over the whole scope and independent of `limit`.
    Present only when `count=true`.

    Each operation counts what it lists. `searchThreads` lists messages of one
    mailbox and counts messages; with `senderTrust` or `dkimMismatch` in the
    query that count is over the enriched window instead, since those are
    resolved off the row. `listAllThreads` counts CONVERSATIONS across every
    non-muted mailbox of every account — a thread holding two matching messages
    counts once, and so does one message reachable through a real folder and a
    virtual copy of it — because that is what the cross-account listing renders
    after collapsing by `threadId`. A count that disagreed with the rows beneath
    it would be a third number for the same set.
    """)
  count?: int32;
}
