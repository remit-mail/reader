import "typespec-electrodb-emitter";

import "../enums/FilterClauseField.tsp";
import "../enums/FilterMatchOperator.tsp";
import "../enums/FilterScope.tsp";
import "../enums/FilterState.tsp";
import "../enums/FilterDisabledReason.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("A single literal predicate clause (from / subject / has-words), combined with its siblings via Filter.matchOperator (RFC 031).")
model FilterClause {
  @doc("Message attribute this clause matches against")
  field: FilterClauseField;

  @doc("Literal text to match")
  value: String256;
}

@doc("Matches when every test in `tests` matches (Sieve `allof`).")
model FilterAllOfTest {
  test: "allof";

  @maxItems(50)
  tests: FilterTest[];
}

@doc("Matches when any test in `tests` matches (Sieve `anyof`).")
model FilterAnyOfTest {
  test: "anyof";

  @maxItems(50)
  tests: FilterTest[];
}

@doc("Matches when `operand` does not (Sieve `not`).")
model FilterNotTest {
  test: "not";
  operand: FilterTest;
}

@doc("Compares one header against one key (Sieve `header`).")
model FilterHeaderTest {
  test: "header";
  match: FilterRuleMatch;
  header: FilterRuleHeader;
  key: String256;
}

@doc("Compares one part of the From address against one key (Sieve `address`). Reads `from` only.")
model FilterAddressTest {
  test: "address";
  match: FilterRuleMatch;
  part: FilterRuleAddressPart;
  key: String256;
}

@doc("Matches when every word occurs in the sender, the subject or the body.")
model FilterHasWordsTest {
  test: "hasWords";
  words: String256[];
}

@doc("A node of a filter rule's test tree (RFC 040).")
union FilterTest {
  allof: FilterAllOfTest,
  anyof: FilterAnyOfTest,
  not: FilterNotTest,
  header: FilterHeaderTest,
  address: FilterAddressTest,
  hasWords: FilterHasWordsTest,
}

@doc("A row written before rules existed: the filter's literal clauses are the truth.")
model FilterRuleV0 {
  version: 0;
}

@doc("A rule whose test is the truth; the row's literal clauses are empty.")
model FilterRuleV1 {
  version: 1;
  test: FilterTest;
}

@doc("A filter's stored rule (RFC 040). Repositories read a version 0 row as version 1, built from its literal clauses.")
union FilterRule {
  v0: FilterRuleV0,
  v1: FilterRuleV1,
}

@doc("""
  A standing user rule that matches messages by literal clauses (RFC 031,
  RFC 034). One row per **standing** filter — `Standing` or `Temporary` scope
  only. The one-time "just these" / "all like these" batch actions never
  create one (RFC 034 recap).
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

  @doc("Standing (permanent) or Temporary (expires). Governs whether expiresAt/ttl are present (RFC 034 Decision 1). Mutable on update (reader #266): switching scope re-derives ttl and re-evaluates state from expiresAt, and bumps ruleChangedAt so a lapsed filter's back-application can be offered again.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  scope: FilterScope;

  @doc("ISO 8601 date-time with zone offset, present only when scope is Temporary (RFC 034 Decision 1.1) — a business date, not an epoch instant. Every evaluation compares `now` against this value directly; it is the source of truth for whether a Temporary filter is still active, independent of `state` or row existence. Mutable on update (reader #266), alongside scope — moving the date bumps ruleChangedAt the same way a scope change does.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  expiresAt?: string;

  @doc("Epoch seconds derived from expiresAt, present only when scope is Temporary. Drives the table-wide DynamoDB TTL delete (RFC 034 Decision 1.3) — the same reserved `ttl` attribute name MailboxLock uses. Must stay absent for Standing filters: DynamoDB treats any attribute literally named `ttl` as eligible for automatic deletion once its value is in the past, so there is no safe non-optional sentinel for \"never expires\" here (RFC 034 Decision 1.4).")
  @visibility(Lifecycle.Create, Lifecycle.Read)
  ttl?: int64;

  @doc("Whether this filter runs, backing byAccountAndState (RFC 034 Decision 1.2). Starts Active. The user sets Active or Disabled on update; the system sets Disabled when the filter cannot work as designed, and records why in disabledReason. Expired is lazily patched the first time something reads a Temporary filter past its expiresAt, which stays the correctness source for expiry.")
  @visibility(Lifecycle.Read, Lifecycle.Update)
  state: FilterState = FilterState.Active;

  @doc("Why this filter is Disabled; `None` whenever state is not Disabled. Written together with state, never on its own: turning a filter on clears it.")
  @visibility(Lifecycle.Read)
  disabledReason: FilterDisabledReason = FilterDisabledReason.None;

  @doc("Epoch seconds, written whenever the predicate, the action, the scope, or the expiry changes (reader #266) — never on a cosmetic rename. This is the broad \"the user asserted something new about this rule\" signal the settings UI uses to decide whether to re-offer a lapsed filter's back-application. It is deliberately NOT the precedence signal for the exclusive move action — see actionChangedAt for that (RFC 034 Decision 3.2, reader #384). Distinct from ElectroDB's own updatedAt, which bumps on any write.")
  @visibility(Lifecycle.Read)
  ruleChangedAt: int64;

  @doc("Epoch seconds, written only when the predicate (literalClauses) or the action (actionLabelId, actionMailboxId) changes — never on scope, expiresAt, or a cosmetic rename. Backs most-recently-changed-filter-wins precedence for the exclusive move action (RFC 034 Decision 3.2). Split out from ruleChangedAt (reader #384): extending a filter's expiry or flipping its scope changes its lifecycle, not what it matches or does, so it must not promote the filter to move-winner.")
  @visibility(Lifecycle.Read)
  actionChangedAt: int64;

  @doc("How literalClauses combine.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  matchOperator: FilterMatchOperator = FilterMatchOperator.And;

  @doc("Literal from/subject/has-words predicate clauses (RFC 031). Empty when the rule is not leaves under one allof or anyof.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  literalClauses: FilterClause[];

  @doc("The stored rule. A version 0 row predates rules and its literalClauses are the truth.")
  @visibility(Lifecycle.Read)
  rule: FilterRule = #{ version: 0 };

  @doc("Evaluation order (RFC 040). Lower runs first; ties go to the newest actionChangedAt, then to filterId. The first move a message reaches wins.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  priority: int32 = 0;

  @doc("When set, a match ends evaluation for that message after this filter's own actions (RFC 040, Sieve `stop`).")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  stop: boolean = false;

  @doc("Label applied when this filter matches — additive action, any number of filters can independently apply their own label (RFC 034 Decision 3.1). The named sentinel `\"None\"` means no label action; never an empty/optional field.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  actionLabelId: string = "None";

  @doc("Mailbox matched messages are moved into — exclusive action, since a message lives in exactly one mailbox (RFC 034 Decision 3.1). On conflict between filters, the one with the latest actionChangedAt wins. `\"None\"` means no move action.")
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
  1.3), never client-supplied. `state`, `ruleChangedAt`, and `filterId` are
  all server-derived and excluded by their Read-only visibility.
  """)
model CreateFilterInput {
  ...OmitProperties<Create<Filter>, "ttl" | "literalClauses">;

  @doc("Literal clauses combined by matchOperator. Send these or rule, never both.")
  literalClauses?: FilterClause[];

  @doc("The rule as a test tree (RFC 040). Send this or literalClauses, never both. The server caps a rule at 50 leaves and 5 levels.")
  rule?: FilterRuleV1;
}

@doc("""
  Input for updating a filter (RFC 034, reader #266). The name, predicate,
  action, scope, and expiresAt are all updatable; `ttl` is always
  server-derived from `scope`/`expiresAt`, never client-supplied, and
  `disabledReason`/`ruleChangedAt`/`actionChangedAt`/`filterId` are
  server-derived too. `state` takes `Active` or `Disabled`: the user turns a
  filter off or back on, and turning it on clears `disabledReason`. `Expired`
  is refused; the expiry is set through `scope`/`expiresAt`. A patch touching the predicate, the action, `scope`, or
  `expiresAt` bumps `ruleChangedAt`; a name-only rename never does (RFC 034
  Decision 3.2, reader #266). Only a patch touching the predicate or the
  action bumps `actionChangedAt`, the narrower signal exclusive-move
  precedence reads (reader #384) — a scope/expiresAt-only edit leaves it
  untouched.
  """)
model UpdateFilterInput {
  ...OptionalProperties<Update<Filter>>;

  @doc("Replaces the rule (RFC 040). Never sent with matchOperator or literalClauses. The server caps a rule at 50 leaves and 5 levels.")
  rule?: FilterRuleV1;
}

// ============================================
// API Response Models
// ============================================

@doc("Filter item returned by list/get/create/update operations. `ttl` is internal bookkeeping (RFC 034 Decision 1.3) and not surfaced.")
model FilterResponse {
  ...OmitProperties<Filter, "ttl" | "rule">;

  @doc("The rule as a test tree (RFC 040). literalClauses mirrors it when it is leaves under one allof or anyof, and is empty otherwise.")
  rule: FilterRuleV1;
}

@doc("Response body for POST /accounts/{accountId}/filters: the created filter, plus the back-apply job that runs it over the inbox.")
model CreateFilterResponse {
  ...FilterResponse;

  @doc("The organize job queued to run the new filter over the inbox. Poll GET /accounts/{accountId}/organize/{organizeJobId}; a filter with nothing to run reports Failed with the reason.")
  organizeJobId: string;
}
