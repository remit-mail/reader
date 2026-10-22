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
  rule.
  """)
model OrganizeInput {
  @doc("Back-apply this standing filter instead of the predicate in this body. The server reads the filter's persisted predicate and action, runs the pass over the inbox, and skips a move another active filter outranks, as index time does. The predicate and action fields of this body are ignored when it is set.")
  filterId?: UUID;

  @doc("How literalClauses combine. Meaningless when literalClauses is empty.")
  matchOperator: FilterMatchOperator = FilterMatchOperator.And;

  @doc("Literal from/subject/has-words clauses (RFC 031), reusing the Filter predicate shape.")
  literalClauses: FilterClause[] = #[];

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
  writes a Filter row — it is a single batch pass, nothing
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

  @doc("The standing filter this job back-applies, or the `\"None\"` sentinel for an \"all like these\" pass. A sentinel, not an optional field, so the persisted entity has no optional attributes (RFC 032).")
  @visibility(Lifecycle.Read)
  filterId: string = "None";

  @doc("Snapshot of how literalClauses combine")
  @visibility(Lifecycle.Read)
  matchOperator: FilterMatchOperator = FilterMatchOperator.And;

  @doc("Snapshot of the literal predicate clauses")
  @visibility(Lifecycle.Read)
  literalClauses: FilterClause[] = #[];

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
model OrganizeJobResponse is PickProperties<
  OrganizeJobRequest,
  | "organizeJobId"
  | "accountConfigId"
  | "userId"
  | "state"
  | "filterId"
  | "matchOperator"
  | "literalClauses"
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
