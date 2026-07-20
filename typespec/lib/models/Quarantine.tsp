import "typespec-electrodb-emitter";

import "../enums/CanonicalMailboxRole.tsp";
import "../enums/QuarantineFailureCode.tsp";
import "../enums/QuarantineFailureStage.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  One node of a quarantined message's MIME tree, in a pre-order walk.
  
  The tree is carried flat with an explicit `depth` rather than as nested
  children: a self-referential model is not expressible here (the entity
  emitter recurses forever on one), and the tree is only ever rendered as an
  indented list, which a pre-order walk reproduces exactly. Nothing caps the
  walk — it is as long as the message has parts.
  
  `contentType` is `type/subtype` only. BODYSTRUCTURE hands the type and its
  parameters over separately, so a node is built from `type`/`subtype` and
  never from a raw content-type line — parameters carry `name=` and
  `filename=`, which name the user's attachments.
  """)
model QuarantineMimeNode {
  @doc("Nesting level, 0 for the root part.")
  depth: int32;

  @doc("Media type of this node, `type/subtype`, parameters stripped.")
  contentType: String140;
}

@doc("""
  A message the sync path could not apply, set aside so the mailbox cursor can
  advance past it (issue #72).
  
  Quarantine is a record, not a flag: the failing message was never written, so
  there is no row to mark. The record carries what was quarantined, why, and
  the diagnostics a bug report needs — it is the artifact, not a side effect of
  one.
  
  Two stored fields are shown on screen and never travel in a report:
  `mailboxPath` (folder names are the user's own words) and `failureMessage`
  (parser errors quote the input that broke them, and redacting arbitrary
  parser output is not solvable). Nothing else here is message content —
  no body, subject, addresses, attachment names, or Message-ID in the clear.
  
  The boundary this entity must not cross: a malformed message is
  quarantinable, an S3, queue or database failure is not. Writing an
  infrastructure failure here would advance the cursor past mail that is fine
  and tell the user it was unreadable.
  """)
@entity("quarantine", "remit")
@doc("Get one entry by identity. `quarantineId` is derived from (accountId, mailboxId, uidValidity, uid), so re-quarantining the same message rewrites the same row instead of accumulating duplicates.")
@index(
  "Quarantine",
  {
    pk: [Quarantine.quarantineId],
    sk: [],
  }
)
@doc("List everything quarantined for one user, newest first — the settings surface, and the set a sync round loads into memory. Scoped to accountConfigId rather than accountId because the surface is per user, not per mail account; the list is expected to stay small enough that a round filters it by mailbox in memory rather than through an index of its own.")
@index(
  "byAccountConfigId",
  {
    index: "gsi1",
    pk: [Quarantine.accountConfigId],
    sk: [Quarantine.quarantinedAt],
  }
)
model Quarantine {
  @doc("Deterministic v5 identity derived from accountId, mailboxId, uidValidity and uid. Idempotent by construction: the same failing message keys the same row on every retry, so nothing has to check for an existing entry before writing one.")
  @visibility(Lifecycle.Read)
  quarantineId: UUID;

  @doc("Owning account configuration — the user. Scopes the settings list and the read endpoint.")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Mail account the message arrived on. Part of the quarantineId derivation.")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Mailbox the message arrived in. Part of the quarantineId derivation.")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("UIDVALIDITY of the mailbox when the message was set aside. A uid means nothing without it — only uidValidity + uid names a message forever (RFC 9051 2.3.1.1), and a mailbox keeps its mailboxId across a bump, so leaving this out would let a stale entry claim the identity of a later, unrelated message and suppress it from a sync round.")
  @visibility(Lifecycle.Read)
  uidValidity: int64;

  @doc("The IMAP uid that was never written. Part of the quarantineId derivation.")
  @visibility(Lifecycle.Read)
  uid: int64;

  @doc("Canonical role of the folder the message arrived in — travels in the report. Absent when the user has appointed no role to that folder, which is the normal state for a plain folder. A sentinel would mean a new member on the shared canonical-role enum, which FolderAppointment would then have to mean something by.")
  @visibility(Lifecycle.Read)
  mailboxRole?: CanonicalMailboxRole;

  @doc("The user's own folder name. Shown on screen, withheld from the report.")
  @visibility(Lifecycle.Read)
  mailboxPath: String512;

  @doc("Epoch millis the message was set aside.")
  @visibility(Lifecycle.Read)
  quarantinedAt: int64;

  @doc("Rounds tried before the message was set aside.")
  @visibility(Lifecycle.Read)
  attempts: int32;

  @doc("Pipeline step that refused the message.")
  @visibility(Lifecycle.Read)
  failureStage: QuarantineFailureStage;

  @doc("The specific defect. Closed vocabulary, because this is what a filed issue quotes.")
  @visibility(Lifecycle.Read)
  failureCode: QuarantineFailureCode;

  @doc("Parser error text. Shown on screen, never in the report.")
  @visibility(Lifecycle.Read)
  failureMessage: String512;

  @doc("Dot-numbered part path the failure is attributable to, off ROOT_PART_PATH. Absent when the failure belongs to no single node — every whole-body parse failure today.")
  @visibility(Lifecycle.Read)
  failurePartPath?: String140;

  @doc("Build of the imap-worker that failed to read the message. Named for the worker, not the app: the record is written by the sync worker, and stamping the client build on a backend parse failure points a maintainer at the wrong commit.")
  @visibility(Lifecycle.Read)
  workerVersion: String64;

  @doc("Top-level Content-Type, `type/subtype` only. Sender-controlled text — escape it wherever it is rendered. Absent together with the other BODYSTRUCTURE-derived fields when the message failed before its structure was read.")
  @visibility(Lifecycle.Read)
  contentType?: String140;

  @doc("Content-Transfer-Encoding as declared. Sender-controlled text. Absent when there was no BODYSTRUCTURE to read it from.")
  @visibility(Lifecycle.Read)
  transferEncoding?: String64;

  @doc("Declared charset. Sender-controlled text. Absent is meaningful: an undeclared charset is a cause in its own right, distinct from a charset nobody recognises.")
  @visibility(Lifecycle.Read)
  charset?: String64;

  @doc("RFC822.SIZE. Separates \"too large\" from \"malformed\". Absent when the FETCH that failed carried no size.")
  @visibility(Lifecycle.Read)
  sizeBytes?: int64;

  @doc("The MIME tree, structure only, as a pre-order walk. The one field here that cannot be a column, because it is a tree; every other message-shape field is flat and stays typed. Empty when the message failed before its BODYSTRUCTURE was read.")
  @visibility(Lifecycle.Read)
  structure: QuarantineMimeNode[] = #[];

  @doc("SHA-256 of the Message-ID, `sha256:` prefixed. Pinned to one algorithm: correlating two reports of the same message is the whole point of the field, and two builds hashing differently make it useless. Absent when the message declared no Message-ID — a hash of the empty string would make every such message correlate with every other, which is worse than no value at all.")
  @visibility(Lifecycle.Read)
  messageIdHash?: String140;

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

@doc("One quarantined message as the settings surface sees it.")
model QuarantineResponse {
  ...Quarantine;
}

@doc("Everything quarantined for the current user, newest first. The list is small by design — a mailbox with a growing quarantine list is a bug being reported, not a page to paginate.")
model QuarantineListResponse {
  @doc("Quarantined messages, newest first.")
  entries: QuarantineResponse[];
}
