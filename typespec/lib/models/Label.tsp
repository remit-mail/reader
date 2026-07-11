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
