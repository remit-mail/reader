import "typespec-electrodb-emitter";

import "../enums/FilterClauseField.tsp";
import "../enums/FilterMatchOperator.tsp";
import "../enums/FilterScope.tsp";
import "../enums/FilterState.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("A single literal predicate clause (from / subject / has-words), combined with its siblings via Filter.matchOperator (RFC 031).")
model FilterClause {
  @doc("Message attribute this clause matches against")
  field: FilterClauseField;

  @doc("Literal text to match")
  value: String256;
}

@doc("""
  A standing user rule that matches messages by literal clauses and/or a
  semantic anchor (RFC 031, RFC 034). One row per **standing** filter —
  `Standing` or `Temporary` scope only. The one-time "just these" / "all like
  these" batch actions never create one (RFC 034 recap).
  
  Kept lean: the semantic anchor payload lives on the sibling `FilterAnchor`
  row (RFC 034 Decision 2.3) so listing/evaluating filters never pulls vector
  data through `byAccountAndState`.
  """)
@entity("filter", "remit")
@index(
  "Filter",
  {
    pk: [Filter.accountConfigId],
    sk: [Filter.filterId],
  }
)
// Plain GSI — Filter is its only member, so no `collection` (RFC 034 Decision 1.2).
@index(
  "byAccountAndState",
  {
    index: "gsi1",
    pk: [Filter.accountConfigId],
    sk: [Filter.state, Filter.filterId],
  }
)
model Filter {
  @doc("Primary identifier. Stable id — the human name is a separate mutable overlay, never the key.")
  @visibility(Lifecycle.Read)
  filterId: UUID;

  @doc("Owning account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Plain-language name or editable label for this filter")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  name: String256;

  @doc("Standing (permanent) or Temporary (expires). Governs whether expiresAt/ttl are present (RFC 034 Decision 1).")
  @visibility(Lifecycle.Create, Lifecycle.Read)
  scope: FilterScope;

  @doc("ISO 8601 date-time with zone offset, present only when scope is Temporary (RFC 034 Decision 1.1) — a business date, not an epoch instant. Every evaluation compares `now` against this value directly; it is the source of truth for whether a Temporary filter is still active, independent of `state` or row existence.")
  @visibility(Lifecycle.Create, Lifecycle.Read)
  expiresAt?: string;

  @doc("Epoch seconds derived from expiresAt, present only when scope is Temporary. Drives the table-wide DynamoDB TTL delete (RFC 034 Decision 1.3) — the same reserved `ttl` attribute name MailboxLock uses. Must stay absent for Standing filters: DynamoDB treats any attribute literally named `ttl` as eligible for automatic deletion once its value is in the past, so there is no safe non-optional sentinel for \"never expires\" here (RFC 034 Decision 1.4).")
  @visibility(Lifecycle.Create, Lifecycle.Read)
  ttl?: int64;

  @doc("Cache of whether this filter is still active, backing byAccountAndState (RFC 034 Decision 1.2). Starts Active; lazily patched to Expired the first time something reads a Temporary filter past its expiresAt — whichever of index-time evaluation, retroactive replay, or a settings-page list touches it next. Never the correctness source; expiresAt is.")
  @visibility(Lifecycle.Read)
  state: FilterState = FilterState.Active;

  @doc("Whether a sibling FilterAnchor row exists for this filter (RFC 034 Decision 2.3). Lets the index-time worker skip the FilterAnchor `get` entirely for purely-literal filters instead of probing for a row that may not exist.")
  @visibility(Lifecycle.Read)
  hasAnchor: boolean = false;

  @doc("Epoch seconds, written only when the predicate (literalClauses, hasAnchor) or the action (actionLabelId, actionMailboxId) changes — never on a cosmetic rename. Backs most-recently-changed-filter-wins precedence for the exclusive move action (RFC 034 Decision 3.2). Distinct from ElectroDB's own updatedAt, which bumps on any write.")
  @visibility(Lifecycle.Read)
  ruleChangedAt: int64;

  @doc("How literalClauses combine. Meaningless when literalClauses is empty.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  matchOperator: FilterMatchOperator = FilterMatchOperator.And;

  @doc("Literal from/subject/has-words predicate clauses (RFC 031). Empty when the filter relies solely on its semantic anchor (see hasAnchor).")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  literalClauses: FilterClause[] = #[];

  @doc("Label applied when this filter matches — additive action, any number of filters can independently apply their own label (RFC 034 Decision 3.1). The named sentinel `\"None\"` means no label action; never an empty/optional field.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  actionLabelId: string = "None";

  @doc("Mailbox matched messages are moved into — exclusive action, since a message lives in exactly one mailbox (RFC 034 Decision 3.1). On conflict between filters, the one with the latest ruleChangedAt wins. `\"None\"` means no move action.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  actionMailboxId: string = "None";

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

// ============================================
// API Input Models
// ============================================

@doc("""
  Input for creating a filter (RFC 034). `ttl` is omitted — it is derived
  server-side from `expiresAt` when `scope` is `Temporary` (RFC 034 Decision
  1.3), never client-supplied. `state`, `hasAnchor`, `ruleChangedAt`, and
  `filterId` are all server-derived and excluded by their Read-only visibility.
  
  When `anchorMessageId` is set, the server builds and persists the filter's
  semantic anchor from that message's indexed vectors (RFC 034 Decision 2) and
  sets `hasAnchor`. Absent for a purely-literal filter.
  """)
model CreateFilterInput {
  ...OmitProperties<Create<Filter>, "ttl">;

  @doc("Anchor message for a semantic filter — provenance for the persisted anchor the server builds at save time (RFC 034 Decision 2.1). Absent for a purely-literal filter.")
  anchorMessageId?: UUID;
}

@doc("Input for updating a filter (RFC 034). Only the mutable name/predicate/action fields are updatable — `scope`, `expiresAt`, and `ttl` are fixed at creation, and `state`/`hasAnchor`/`ruleChangedAt`/`filterId` are server-derived. A patch touching a predicate or action field bumps `ruleChangedAt`; a name-only rename never does (RFC 034 Decision 3.2).")
model UpdateFilterInput is Update<Filter>;

// ============================================
// API Response Models
// ============================================

@doc("Filter item returned by list/get/create/update operations. `ttl` is internal bookkeeping (RFC 034 Decision 1.3) and not surfaced.")
model FilterResponse {
  ...OmitProperties<Filter, "ttl">;
}
