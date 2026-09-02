import "typespec-electrodb-emitter";

import "../enums/AuthResultVerdict.tsp";
import "../enums/AuthenticityVerdict.tsp";
import "../enums/DisplayNameCorrespondence.tsp";
import "../enums/LabelAction.tsp";
import "../enums/MessageCategory.tsp";
import "../enums/MessageFlag.tsp";
import "../enums/MessageStatus.tsp";
import "../enums/MessageSyncStatus.tsp";
import "../enums/PlacementAction.tsp";
import "../enums/PlacementConfidence.tsp";
import "../enums/SenderTrust.tsp";
import "../enums/StarColor.tsp";
import "../scalars/string.tsp";
import "./Label.tsp";

namespace RemitImap;

@doc("Structured sender-authenticity signal, derived from headers at classification time. Absent for messages classified before this field was introduced — clients should treat absence as no-signal.")
model MessageAuthenticity {
  @doc("Domain of the From header address")
  fromDomain: string;

  @doc("DKIM signing domain (d=) that was compared, when a signature is present")
  dkimDomain?: string;

  @doc("True when DKIM signing domain(s) are present and none aligns with the From domain")
  dkimMismatch: boolean;

  @doc("How the From display name relates to the From domain. Present only for a message the provider's own filter already classified as spam, and only when the sender is not bulk-shaped (no List-Unsubscribe) — absence means the comparison was never made, never that it found nothing.")
  displayNameCorrespondence?: DisplayNameCorrespondence;

  @doc("Registrable domains (eTLD+1) the body's links point at, excluding the From address's own registrable domain. Present only for a message the provider's own filter already classified as spam; an empty array means every link stayed on the sender's domain, absence means the comparison was never made.")
  offDomainLinkDomains?: string[];

  @doc("Registrable domain of the first verified DKIM `header.d` in trusted Authentication-Results order, or the reserved literal `unverified` when no identity could be established. Unlike `dkimDomain`, which is the unverified `d=` claim the sender wrote, this is only set from a signature the trusted Authentication-Results reported as passing. Absent for messages classified before the field existed.")
  signerDomain?: string;

  @doc("SPF-checked envelope-from domain (`smtp.mailfrom`, falling back to `smtp.helo`) from the trusted Authentication-Results. Absent when the trusted header carried no SPF clause, or for messages classified before the field existed.")
  envelopeDomain?: string;

  @doc("Messages this account had already seen for the sender's standing key when this message arrived. A snapshot frozen at derivation time, deliberately not a live read — a message classified when the key stood at 340 always reads 340. Absent for messages classified before the field existed.")
  signerMessageCount?: int32;

  @doc("Epoch milliseconds this account first saw the sender's standing key, snapshotted at derivation time alongside `signerMessageCount`. Absent for messages classified before the field existed.")
  signerFirstSeenAt?: int64;
}

@doc("Provider authentication-results verdict, parsed from the Authentication-Results header at body-sync time. Absent for messages synced before this field was introduced.")
model MessageAuthResult {
  @doc("DMARC verdict (dmarc=)")
  dmarc?: AuthResultVerdict;

  @doc("SPF verdict (spf=)")
  spf?: AuthResultVerdict;

  @doc("DKIM verdict (dkim=)")
  dkim?: AuthResultVerdict;
}

@doc("Provider spam-filter signal, parsed from X-SpamExperts-Class / X-Spam-Status / X-HalOne-Spam-Probability at body-sync time. Absent for messages synced before this field was introduced.")
model MessageProviderSpam {
  @doc("True when the provider's filter classified this message as spam.")
  classified: boolean;

  @doc("Raw spam score string from the header, when present.")
  score?: string;

  @doc("Header name the signal was read from, for diagnostics.")
  source?: string;
}

@doc("Remit's placement decision for a message, recorded at body-sync time. Present only when Remit decided to act (action != leave); absent when the message was left in place or synced before placement rolled out. Written in dry-run too, so the dark-ship verdict distribution is queryable before moves are enabled.")
model MessagePlacementVerdict {
  @doc("The direction Remit decided to move the message.")
  action: PlacementAction;

  @doc("Confidence of the verdict. Only `Confident` verdicts enqueue an IMAP move (when the dark-ship flag is on).")
  confidence: PlacementConfidence;

  @doc("The folder the message was in when the verdict was made: inbox | junk | other.")
  fromPlacement: string;

  @doc("Deterministic signals the verdict was based on, for diagnostics.")
  reasons: string[];

  @doc("True when the dark-ship flag was off, so the move was computed but not enqueued (would-move only). False when a real IMAP move was enqueued.")
  dryRun: boolean;

  @doc("Body-sync timestamp the verdict was decided at (epoch millis).")
  decidedAt: int64;
}

@doc("Recorded when a standing filter (RFC 034) moved this message at body-sync time. Present only for a real, index-time filter move, so the client can render the badge naming the destination, offer an undo back to the source folder, and link to the filter in Settings. A retroactive back-apply move attributes to no filter and never writes this (RFC 034 Decision 3.3).")
model MessageFilterMove {
  @doc("The standing filter that moved the message — lets the client link the badge to Settings › Filters.")
  filterId: UUID;

  @doc("The mailbox the message was in before the filter moved it. The undo target: undo returns the message here and does not disable the filter.")
  sourceMailboxId: UUID;

  @doc("The mailbox the filter moved the message into. The move is still in effect while the message sits here; any move away (undo or manual) clears the badge.")
  destinationMailboxId: UUID;

  @doc("Body-sync timestamp the move was decided at (epoch millis).")
  decidedAt: int64;
}

@doc("Recorded when the user reported this message as spam via `POST /messages/report-spam`. Present means the report stands; absent means never reported, or reported and then undone via `POST /messages/not-spam` (which clears it). Backs the \"Reported as spam · Undo\" affordance independent of the message's current folder — the underlying move can settle, fail, or no-op (already in Junk) without changing whether the report itself is shown.")
model MessageSpamReport {
  @doc("Timestamp (epoch millis) the report was made.")
  reportedAt: int64;
}

@doc("Present only when Remit auto-moved this message on body-sync. Two shapes share this model: a classifier placement move carries `action` + `fromPlacement` (Inbox/Junk direction); a standing-filter move carries `fromMailboxId` + `destinationMailboxId` + `filterId` (an arbitrary destination folder). Absent means the message was not auto-moved by Remit — clients treat absence as no indicator.")
model AutoMovedInfo {
  @doc("Classifier move only: direction Remit moved the message — MoveToInbox | MoveToJunk. Absent for a standing-filter move, which names its destination via `destinationMailboxId` instead.")
  action?: PlacementAction;

  @doc("Classifier move only: folder role the message was moved from — inbox | junk | other. Used to render \"moved from Junk\" and to resolve the undo target via MailboxRole. Absent for a standing-filter move, which names its source via `fromMailboxId`.")
  fromPlacement?: string;

  @doc("Standing-filter move only: the mailbox the message was moved out of. The undo target — the client resolves its display name for the badge and moves the message back here.")
  fromMailboxId?: UUID;

  @doc("Standing-filter move only: the mailbox the filter moved the message into. The move is still in effect while the message sits here.")
  destinationMailboxId?: UUID;

  @doc("Standing-filter move only: the filter that moved the message, for the Settings › Filters link. Undo does not disable it.")
  filterId?: UUID;
}

@doc("Core message entity. The combination of Mailbox.uidValidity + Message.uid uniquely identifies a message forever per RFC 9051 Section 2.3.1.1.")
@entity("message", "remit")
@index(
  "Message",
  {
    pk: [Message.messageId],
    sk: [],
  }
)
@index(
  "byMailboxId",
  {
    collection: "message",
    index: "gsi0",
    pk: [Message.mailboxId],
    sk: [Message.uid],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [Message.messageId],
    sk: [],
  }
)
model Message {
  @doc("Primary identifier (internal UUID)")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent mailbox")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("IMAP UID - unique within mailbox, strictly ascending, never reused under same UIDVALIDITY")
  @visibility(Lifecycle.Read)
  @minValue(1)
  uid: int64;

  @doc("Relative position (1-based), changes on EXPUNGE")
  @visibility(Lifecycle.Read)
  @minValue(1)
  sequenceNumber: int32;

  @doc("Message size in octets in RFC 5322 format")
  @visibility(Lifecycle.Read)
  @minValue(0)
  rfc822Size: int64;

  @doc("Server receipt timestamp (INTERNALDATE)")
  @visibility(Lifecycle.Read)
  internalDate: int64;

  @doc("Message-ID header value for quick reference")
  @visibility(Lifecycle.Read)
  messageIdHeader?: string;

  @doc("Reference to parsed envelope data")
  @visibility(Lifecycle.Read)
  envelopeId: UUID;

  @doc("Reference to root body part for BODYSTRUCTURE")
  @visibility(Lifecycle.Read)
  rootBodyPartId: UUID;

  @doc("Storage URI for the message body (set when body has been fetched and stored)")
  @visibility(Lifecycle.Read)
  bodyStorageKey?: string;

  @doc("Message lifecycle status for move/delete operations. Defaults to `active` (normal, visible).")
  @visibility(Lifecycle.Read)
  status: MessageStatus = MessageStatus.active;

  @doc("Sync status for move/delete operations. The `synced` column default only applies to a row written without the field: the repository always supplies one, and an ordinary inbound sync writes `pending`, which nothing later promotes. So `pending` here does not mean an outstanding move or delete — `status` names that, and `failed` marks a mutation that gave up.")
  @visibility(Lifecycle.Read)
  syncStatus: MessageSyncStatus = MessageSyncStatus.synced;

  @doc("Original mailbox ID before move (for restore from trash)")
  @visibility(Lifecycle.Read)
  originalMailboxId?: UUID;

  @doc("Original UID before move (for debugging/audit)")
  @visibility(Lifecycle.Read)
  originalUid?: int64;

  @doc("Header-derived category. Defaults to `uncategorized` for messages that have been metadata-synced but not yet body-classified — that pending state is a named value, not absence.")
  @visibility(Lifecycle.Read)
  category: MessageCategory = MessageCategory.uncategorized;

  @doc("Structured sender-authenticity signal derived from DKIM headers at classification time. Absent for messages classified before this field was introduced — absence means no signal.")
  @visibility(Lifecycle.Read)
  authenticity?: MessageAuthenticity;

  @doc("Sender-authenticity tier resolved at body-sync. Defaults to `NotEvaluated`, the named pending state every message written before the derivation existed carries. Top-level rather than a member of `authenticity` on purpose: that blob is absent for all unsigned mail, so a guard keyed on its absence cannot tell \"never derived\" from \"nothing to derive\" and would re-derive unsigned mail forever.")
  @visibility(Lifecycle.Read)
  authenticityVerdict: AuthenticityVerdict = AuthenticityVerdict.NotEvaluated;

  @doc("Provider authentication-results signal parsed from Authentication-Results header. Absent for messages synced before this field was introduced.")
  @visibility(Lifecycle.Read)
  authResult?: MessageAuthResult;

  @doc("Provider spam-filter signal from X-Spam-* / X-SpamExperts-Class headers. Absent for messages synced before this field was introduced.")
  @visibility(Lifecycle.Read)
  providerSpam?: MessageProviderSpam;

  @doc("True when a List-Unsubscribe header is present, indicating a bulk/mailing-list sender. Defaults to false.")
  @visibility(Lifecycle.Read)
  hasListUnsubscribe: boolean = false;

  @doc("Set to true when Remit auto-moved this message out of Junk via the rescue heuristic. Guards against re-rescue loops. Defaults to false.")
  @visibility(Lifecycle.Read)
  movedByRemit: boolean = false;

  @doc("Remit's placement verdict, recorded when Remit decided to act (action != leave). Absent means left-in-place or synced before placement rolled out. Recorded in dry-run too, so the dark-ship distribution is queryable.")
  @visibility(Lifecycle.Read)
  placementVerdict?: MessagePlacementVerdict;

  @doc("Recorded when a standing filter moved this message at body-sync time (RFC 034). Absent means no filter moved it — a classifier move records `placementVerdict` instead, and a retroactive back-apply records neither. Drives the arbitrary-destination auto-moved badge and its undo.")
  @visibility(Lifecycle.Read)
  filterMove?: MessageFilterMove;

  @doc("Body-sync timestamp (epoch millis) the classifier's placement verdict was first decided, whether the verdict was to move the message or to leave it in place. Absent means placement has never been evaluated for this message. Guards `computePlacement` against a re-entrant body-sync pass (`fetchAndGetBody`'s `NoSuchKey` fallback, `syncBodies(..., force: true)`) re-deciding — and possibly reversing — a placement a user has since overridden by hand. `movedByRemit` remains the guard for a message that was placement-decided before this field existed.")
  @visibility(Lifecycle.Read)
  placementDecidedAt?: int64;

  @doc("Recorded when the user reported this message as spam. Absent means never reported, or reported and then undone (`POST /messages/not-spam` clears it). Independent of the message's current folder — deliberately not derived from \"sits in Junk\", which is also true of a message Remit moved on its own.")
  @visibility(Lifecycle.Read)
  spamReport?: MessageSpamReport;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Message flags as defined in RFC 9051 Section 2.3.2")
@entity("messageFlag", "remit")
@index(
  "MessageFlag",
  {
    pk: [MessageFlag.messageFlagId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [MessageFlag.messageId],
    sk: [MessageFlag.messageFlagId],
  }
)
model MessageFlag {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  messageFlagId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Flag value: system flag, common keyword, or custom keyword")
  @visibility(Lifecycle.Read)
  flagName: MessageFlagValue;

  @doc("When the flag was set")
  @visibility(Lifecycle.Read)
  setAt: int64;

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

@doc("Core message metadata for API responses")
model MessageSummaryResponse {
  ...PickProperties<
    Message,

      | "messageId"
      | "mailboxId"
      | "uid"
      | "rfc822Size"
      | "internalDate"
      | "messageIdHeader"
      | "authenticity"
  >;

  @doc("Present only when Remit auto-moved this message on body-sync. Absent means the message was not auto-moved by Remit.")
  autoMoved?: AutoMovedInfo;

  @doc("Labels applied to this message — filter-, organize-, and manually-applied alike (issue #26). Absent/empty means no label is applied.")
  labels?: LabelSummaryResponse[];

  @doc("Present when the user reported this message as spam and the report has not been undone. Backs the \"Reported as spam · Undo\" affordance.")
  spamReport?: MessageSpamReport;
}

@doc("Message envelope (header metadata)")
model EnvelopeResponse {
  @doc("Reference to parent message")
  messageId: UUID;

  @doc("Message date")
  date: int64;

  @doc("Message subject")
  subject?: string;

  @doc("RFC 2822 Message-ID header value")
  messageIdValue?: string;

  @doc("From addresses")
  from: EnvelopeAddressResponse[];

  @doc("To addresses")
  to: EnvelopeAddressResponse[];

  @doc("CC addresses")
  cc: EnvelopeAddressResponse[];

  @doc("BCC addresses")
  bcc: EnvelopeAddressResponse[];

  @doc("Reply-To addresses")
  replyTo: EnvelopeAddressResponse[];

  @doc("Header-derived category for the message. Always present: `Message.category` is NOT NULL with an `uncategorized` default, and `uncategorized` names the not-yet-classified state rather than standing for absence (issue #45).")
  category: MessageCategory;

  @doc("Trust level for the From address, derived from AddressFlags at read time.")
  senderTrust: SenderTrust;
}

@doc("Complete message description including all related data. Body content is delivered via the per-part `BodyPartResponse.contentUrl` (CloudFront, JWT-authorized at the edge); the legacy `bodyText`/`bodyHtml` fields were removed once content delivery cut over end-to-end (#224).")
model DescribeMessageResponse {
  @doc("Core message metadata")
  message: MessageSummaryResponse;

  @doc("Envelope data")
  envelope: EnvelopeResponse;

  @doc("Message flags")
  flags: string[];

  @doc("Body structure. Each part exposes `contentUrl` for fetching its bytes.")
  bodyParts: BodyPartResponse[];

  @doc("Message references (In-Reply-To and References headers)")
  references: MessageReferenceResponse[];
}

@doc("Raw RFC822/MIME source of a message (headers and body), decoded as a string for inspection.")
model RawMessageResponse {
  @doc("The complete RFC822/MIME source of the message, headers included.")
  raw: string;
}

// ============================================
// API Input Models
// ============================================

@doc("Input for updating message flags (translated to IMAP flags server-side)")
model UpdateFlagsInput {
  @doc("Set message as read (maps to \\Seen flag)")
  isRead?: boolean;

  @doc("Set message as starred (maps to \\Flagged flag)")
  isStarred?: boolean;

  @doc("Star color for visual categorization")
  starColor?: StarColor;
}

@doc("Input for bulk message operations")
model BulkMessageInput {
  @doc("List of message IDs to operate on")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];
}

@doc("Input for moving messages")
model MoveMessagesInput {
  ...BulkMessageInput;

  @doc("Destination mailbox ID")
  destinationMailboxId: UUID;
}

@doc("Bulk operation result for message operations")
model MessageBulkOperationResult {
  @doc("Number of items accepted for processing")
  successCount: int32;

  @doc("Number of items rejected before processing")
  failureCount: int32;
}

@doc("One message's failure reason within a report-spam or not-spam bulk call.")
model SpamReportFailure {
  @doc("The message that failed")
  messageId: UUID;

  @doc("Why it failed, safe to show the user as-is. One of a small allowlisted set of user-facing messages (e.g. \"has not settled yet\" while a prior move is still in flight) — never a raw internal error, which is logged server-side instead and never returned here. Not intended to be parsed programmatically.")
  reason: string;
}

@doc("Result of a report-spam or not-spam bulk call. Extends the standard counts with a reason per failed message: a partial failure here is an expected, routine outcome (a move from a prior press still settling) the client should be able to explain, not just count.")
model SpamReportBulkResult {
  ...MessageBulkOperationResult;

  @doc("One entry per message that failed, naming why. Absent or empty when every message succeeded.")
  failures?: SpamReportFailure[];
}

// ============================================
// Bulk Flag Update
// ============================================

@doc("Input for bulk flag update operations")
model BulkUpdateFlagsInput {
  @doc("List of message IDs to update")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];

  @doc("Set messages as read (maps to \\Seen flag)")
  isRead?: boolean;

  @doc("Set messages as starred (maps to \\Flagged flag)")
  isStarred?: boolean;

  @doc("Star color for visual categorization")
  starColor?: StarColor;
}

// ============================================
// Delete Messages (with options)
// ============================================

@doc("Input for deleting messages")
model DeleteMessagesInput {
  @doc("List of message IDs to delete")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];

  @doc("Permanently delete instead of moving to Trash. Default: false")
  permanent?: boolean;
}

// ============================================
// Copy Messages
// ============================================

@doc("Input for copying messages to another mailbox")
model CopyMessagesInput {
  @doc("List of message IDs to copy")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];

  @doc("Destination mailbox ID")
  destinationMailboxId: UUID;
}

// ============================================
// Manual Label Apply/Remove (issue #26)
// ============================================

@doc("Input for a manual bulk label action — the \"just these\" scope (RFC 034 recap). `appliedByFilterId` never gets set on the resulting `MessageLabel` rows; that provenance is reserved for filter/organize applies (RFC 034 Decision 3.3).")
model UpdateMessageLabelsInput {
  ...BulkMessageInput;

  @doc("Label to apply or remove")
  labelId: UUID;

  @doc("Whether to apply or remove the label")
  action: LabelAction;
}

// ============================================
// Empty Trash Response
// ============================================

@doc("Response from emptying trash")
model EmptyTrashResponse {
  @doc("Number of messages permanently deleted")
  deletedCount: int32;
}
