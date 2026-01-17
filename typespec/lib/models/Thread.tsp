import "typespec-electrodb-emitter";

import "../enums/StarColor.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Denormalized thread view optimized for listing. Reconstructible from ThreadMessage records.")
@entity("thread", "remit")
// Primary: stable SK (threadId only) allows in-place updates when lastMessageAt changes
@index(
  "Thread",
  {
    collection: "accountThreads",
    pk: [Thread.accountConfigId],
    sk: [Thread.threadId],
  }
)
// GSI0: single thread lookup by ID, shared collection with ThreadMessage/ThreadParticipant
@index(
  "byThreadId",
  {
    collection: "threadDetails",
    index: "gsi0",
    pk: [Thread.threadId],
    sk: [],
  }
)
// LSI1: main listing sorted by date
@index(
  "byLastMessageAt",
  {
    index: "lsi1",
    pk: [Thread.accountConfigId],
    sk: [Thread.lastMessageAt, Thread.threadId],
  }
)
// LSI2: filter unread, sorted by date
@index(
  "byUnread",
  {
    index: "lsi2",
    pk: [Thread.accountConfigId],
    sk: [Thread.hasUnread, Thread.lastMessageAt, Thread.threadId],
  }
)
// LSI3: filter starred, sorted by date
@index(
  "byStarred",
  {
    index: "lsi3",
    pk: [Thread.accountConfigId],
    sk: [Thread.hasStars, Thread.lastMessageAt, Thread.threadId],
  }
)
// LSI4: date range queries on firstMessageAt
@index(
  "byDateRange",
  {
    index: "lsi4",
    pk: [Thread.accountConfigId],
    sk: [Thread.firstMessageAt, Thread.threadId],
  }
)
// LSI5: filter threads with attachments, sorted by date
@index(
  "byAttachments",
  {
    index: "lsi5",
    pk: [Thread.accountConfigId],
    sk: [Thread.hasAttachments, Thread.lastMessageAt, Thread.threadId],
  }
)
model Thread {
  @doc("Primary identifier derived from root Message-ID")
  @visibility(Lifecycle.Read)
  threadId: UUID;

  @doc("Reference to parent account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Original subject from first message in thread")
  @visibility(Lifecycle.Read)
  subject?: string;

  @doc("Normalized subject with Re:/Fwd: prefixes removed")
  @visibility(Lifecycle.Read)
  subjectNormalized?: string;

  @doc("Unique participant emails ordered by recency (max 50)")
  @visibility(Lifecycle.Read)
  participants: string[];

  @doc("Total unique participants in thread")
  @visibility(Lifecycle.Read)
  @minValue(0)
  participantCount: int32;

  @doc("Total messages in thread")
  @visibility(Lifecycle.Read)
  @minValue(1)
  messageCount: int32;

  @doc("Count of unread messages")
  @visibility(Lifecycle.Read)
  @minValue(0)
  unreadCount: int32;

  @doc("True if any messages are unread (for index filtering)")
  @visibility(Lifecycle.Read)
  hasUnread: boolean;

  @doc("True if any messages have attachments")
  @visibility(Lifecycle.Read)
  hasAttachments: boolean;

  @doc("True if any messages are starred")
  @visibility(Lifecycle.Read)
  hasStars: boolean;

  @doc("Thread-level star color")
  @visibility(Lifecycle.Read)
  star?: StarColor;

  @doc("Mailbox IDs containing thread messages")
  @visibility(Lifecycle.Read)
  mailboxIds: string[];

  @doc("Preview text from most recent message")
  @visibility(Lifecycle.Read)
  snippet?: String512;

  @doc("Timestamp of earliest message in thread")
  @visibility(Lifecycle.Read)
  firstMessageAt: int64;

  @doc("Timestamp of most recent message in thread")
  @visibility(Lifecycle.Read)
  lastMessageAt: int64;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
