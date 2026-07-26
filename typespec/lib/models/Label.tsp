import "typespec-electrodb-emitter";

import "../enums/LabelColor.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("A user-defined label definition, scoped to an account (RFC 030). labelId is a stable id; name is a separate mutable overlay, never the key.")
@entity("label", "remit")
@index(
  "Label",
  {
    pk: [Label.accountConfigId],
    sk: [Label.labelId],
  }
)
@index(
  "byNormalizedName",
  {
    index: "gsi0",
    pk: [Label.accountConfigId],
    sk: [Label.normalizedName],
  }
)
model Label {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  labelId: UUID;

  @doc("Owning account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Human-readable label name (display)")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  name: String140;

  @doc("Lowercased/trimmed form of name, used for dedupe via byNormalizedName")
  @visibility(Lifecycle.Read)
  normalizedName: String140;

  @doc("Display color for this label")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  color: LabelColor = LabelColor.Default;

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

@doc("Input for creating a label (RFC 030). `normalizedName` is server-derived from `name` and excluded by its Read-only visibility.")
model CreateLabelInput is Create<Label>;

@doc("Input for updating a label (RFC 030). Only `name` and `color` are mutable.")
model UpdateLabelInput is Update<Label>;

// ============================================
// API Response Models
// ============================================

@doc("Label item returned by list/get/create/update operations (RFC 030). `filterCount` is computed at read time so a client can name the blast radius before confirming a delete — the delete itself never blocks on it (issue #26).")
model LabelResponse {
  ...OmitProperties<Label, "normalizedName">;

  @doc("Number of the account's filters whose `actionLabelId` is this label. Deleting the label deletes every one of them (issue #26) — a client shows this count in its delete confirmation.")
  filterCount: int32;
}

@doc("The id, name, and color of a label applied to a message — embedded on message/thread read responses (issue #26). Never the full LabelResponse: a read-time attachment carries no filterCount.")
model LabelSummaryResponse {
  labelId: UUID;
  name: String140;
  color: LabelColor;
}
