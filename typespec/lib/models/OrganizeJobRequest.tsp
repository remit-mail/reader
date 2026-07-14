import "typespec-electrodb-emitter";
import "@typespec/http";

import "../enums/FilterMatchOperator.tsp";
import "../enums/OrganizeJobState.tsp";
import "../scalars/string.tsp";
import "./Filter.tsp";

using TypeSpec.Http;

namespace RemitImap;

@doc("""
  The predicate + action for a one-time "all like these" back-apply (RFC 034
  recap, #1278). A distinct model, deliberately NOT a Filter: it carries no
  `scope`, `expiresAt`, or `name`, so it structurally cannot create a standing
  rule. The anchor is derived transiently from `anchorMessageId`'s existing chunk
  vectors at match time and never persisted as a FilterAnchor row.
  """)
model OrganizeInput {
  @doc("Anchor message for the semantic half — \"all like this one\". Absent for a purely-literal back-apply. The anchor vector is pooled transiently from this message's indexed chunk vectors and never written to a FilterAnchor row.")
  anchorMessageId?: UUID;

  @doc("How literalClauses combine. Meaningless when literalClauses is empty.")
  matchOperator: FilterMatchOperator = FilterMatchOperator.And;

  @doc("Literal from/subject/has-words clauses (RFC 031), reusing the Filter predicate shape. Empty when the back-apply relies solely on the semantic anchor.")
  literalClauses: FilterClause[] = #[];

  @doc("Cosine cut-off for the semantic match. Absent uses the server default (the same threshold the index-time filter pipeline applies).")
  similarityThreshold?: float64;

  @doc("Label applied to every matching message — additive action (RFC 034 Decision 3.1). The `\"None\"` sentinel means no label action.")
  actionLabelId: string = "None";

  @doc("Mailbox every matching message is moved into — exclusive action (RFC 034 Decision 3.1). The `\"None\"` sentinel means no move action.")
  actionMailboxId: string = "None";
}

@doc("""
  An async "all like these" back-apply job (RFC 034 recap, #1278). Modeled on
  AccountExportRequest: a Pending row the account-fanout worker picks up, drives
  to Running, then to Complete/Failed, self-reaping via the table-wide `ttl`.
  
  The predicate + action are snapshotted onto the row (the same fields as
  OrganizeInput) so the worker runs exactly what was requested. This job never
  writes a Filter or FilterAnchor row — it is a single batch pass, nothing
  standing to persist.
  """)
@entity("organizeJobRequest", "remit")
@index(
  "OrganizeJobRequest",
  {
    pk: [OrganizeJobRequest.organizeJobId],
    sk: [],
  }
)
@index(
  "byAccountConfigId",
  {
    index: "gsi0",
    pk: [OrganizeJobRequest.accountConfigId],
    sk: [OrganizeJobRequest.createdAt],
  }
)
model OrganizeJobRequest {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  organizeJobId: UUID;

  @doc("Owning account config")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Cognito user id of the requesting user")
  @visibility(Lifecycle.Read)
  userId: string;

  @doc("Current lifecycle state of the job")
  @visibility(Lifecycle.Read)
  state: OrganizeJobState = OrganizeJobState.Pending;

  @doc("Snapshot of the anchor message id, or the `\"None\"` sentinel for a purely-literal back-apply. A sentinel, not an optional field, so the persisted entity has no optional attributes (RFC 032).")
  @visibility(Lifecycle.Read)
  anchorMessageId: string = "None";

  @doc("Snapshot of how literalClauses combine")
  @visibility(Lifecycle.Read)
  matchOperator: FilterMatchOperator = FilterMatchOperator.And;

  @doc("Snapshot of the literal predicate clauses")
  @visibility(Lifecycle.Read)
  literalClauses: FilterClause[] = #[];

  @doc("Snapshot of the semantic cut-off applied for this run")
  @visibility(Lifecycle.Read)
  similarityThreshold: float64 = 0.75;

  @doc("Snapshot of the additive label action, or `\"None\"`")
  @visibility(Lifecycle.Read)
  actionLabelId: string = "None";

  @doc("Snapshot of the exclusive move action, or `\"None\"`")
  @visibility(Lifecycle.Read)
  actionMailboxId: string = "None";

  @doc("Number of messages matched by the predicate, set when the pass completes")
  @visibility(Lifecycle.Read)
  matchedCount: int32 = 0;

  @doc("Number of matches the action was successfully applied to")
  @visibility(Lifecycle.Read)
  appliedCount: int32 = 0;

  @doc("Number of matches whose action apply failed")
  @visibility(Lifecycle.Read)
  failedCount: int32 = 0;

  @doc("Human-readable error message; empty unless state is Failed")
  @visibility(Lifecycle.Read)
  errorMessage: string = "";

  @doc("Epoch seconds after which the job row is reclaimed by the table-wide DynamoDB TTL (RFC 034 Decision 1) — the reserved `ttl` attribute. Set at creation to a fixed future time; the job runs once and needs no standing lifetime.")
  @visibility(Lifecycle.Read)
  ttl: int64;

  @doc("Epoch millis when the job was created")
  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @doc("Epoch millis when the job was last updated")
  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

// ============================================
// API Response Models
// ============================================

@doc("Response body for POST /accounts/{accountId}/organize")
model CreateOrganizeJobResponse {
  @statusCode statusCode: 202;

  @doc("ID of the newly created organize job")
  organizeJobId: string;

  @doc("Initial state of the job (Pending)")
  state: OrganizeJobState;
}

@doc("Job item returned by GET /accounts/{accountId}/organize/{organizeJobId}. `ttl` is internal bookkeeping and not surfaced.")
model OrganizeJobResponse
  is PickProperties<
    OrganizeJobRequest,

      | "organizeJobId"
      | "accountConfigId"
      | "userId"
      | "state"
      | "anchorMessageId"
      | "matchOperator"
      | "literalClauses"
      | "similarityThreshold"
      | "actionLabelId"
      | "actionMailboxId"
      | "matchedCount"
      | "appliedCount"
      | "failedCount"
      | "errorMessage"
      | "createdAt"
      | "updatedAt"
  >;

@doc("Response body for POST /accounts/{accountId}/organize/preview — the messages the same matcher would apply the action to, without applying it. Bounded server-side.")
model OrganizePreviewResponse {
  @doc("Number of messages the predicate matched within the bounded pass")
  matchedCount: int32;

  @doc("Ids of the matching messages, bounded to the same cap the apply pass uses")
  messageIds: string[];
}
