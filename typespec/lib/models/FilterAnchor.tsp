import "typespec-electrodb-emitter";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  Persisted semantic-anchor payload for a Filter with `hasAnchor: true` (RFC
  034 Decision 2). One row only for a filter with a semantic anchor — a
  purely-literal filter has none.
  
  Keys mirror `Filter`'s primary key, so once the index-time worker has a
  candidate `filterId` from `byAccountAndState`, fetching its anchor is a
  single deterministic `get`, never a query.
  
  Deliberately sets no `gsi1pk`/`gsi1sk`: never a member of
  `byAccountAndState`, so it is never replicated into that GSI and never
  loaded by the index-time worker's per-message filter listing — only by the
  explicit `get` once a filter is already a semantic candidate (RFC 034
  Decision 2.3).
  """)
@entity("filterAnchor", "remit")
@index(
  "FilterAnchor",
  {
    pk: [FilterAnchor.accountConfigId],
    sk: [FilterAnchor.filterId],
  }
)
model FilterAnchor {
  @doc("Owning account configuration — mirrors the sibling Filter row's key")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Filter this anchor belongs to — mirrors the sibling Filter row's key")
  @visibility(Lifecycle.Read)
  filterId: UUID;

  @doc("Persisted anchor vector: mean-pooled (or dominant-chunk) from the anchor message's chunk vectors at save time (RFC 034 Decision 2.1). ~18 KB as DynamoDB decimal-string-encoded numbers (Decision 2.3) — well under the 400 KB item limit, written once, never grown.")
  @visibility(Lifecycle.Read)
  anchorEmbedding: float64[];

  @doc("`<modelId>@<dimensions>` identifier, e.g. \"amazon.titan-embed-text-v2:0@1024\" — the same id packages/remit-search-service/src/embeddings.ts derives for chunk vectors. Lets a migration detect anchors whose model has gone stale (RFC 034 Decision 2.4).")
  @visibility(Lifecycle.Read)
  anchorEmbeddingId: string;

  @doc("The anchor message's textPreview at save time, bounded to buildTextPreview's existing budget (RFC 034 Decision 2.1). Retained so a stale anchor is always re-embeddable without depending on the source message still existing (Decision 2.4).")
  @visibility(Lifecycle.Read)
  anchorSourceText: String512;

  @doc("Provenance/display only — \"based on this message\" (RFC 034 Decision 2.1). Never re-read at match time. May dangle if the source message is later deleted; anchorEmbedding/anchorSourceText are unaffected, since they are copies, not references.")
  @visibility(Lifecycle.Read)
  anchorMessageId: UUID;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
