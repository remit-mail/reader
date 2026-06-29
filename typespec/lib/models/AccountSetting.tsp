import "typespec-electrodb-emitter";

import "../scalars/string.tsp";
import "./Address.tsp";

namespace RemitImap;

@doc("Typed value for a user setting. `kind` discriminates the concrete shape; a registry binds each setting name to the kind it requires.")
@discriminator("kind")
model AccountSettingValue {
  kind: string;
}

@doc("Boolean-valued setting (a toggle)")
model BooleanSetting extends AccountSettingValue {
  kind: "Boolean";
  value: boolean;
}

@doc("String-valued setting (an enum choice or free text)")
model StringSetting extends AccountSettingValue {
  kind: "String";
  value: string;
}

@doc("Number-valued setting")
model NumberSetting extends AccountSettingValue {
  kind: "Number";
  value: float64;
}

@doc("Ordered list of strings (e.g. pinned folders)")
model StringListSetting extends AccountSettingValue {
  kind: "StringList";
  value: string[];
}

@doc("String-keyed sub-configuration map")
model MapSetting extends AccountSettingValue {
  kind: "Map";
  value: Record<string>;
}

@doc("MutedFlag-valued setting (a rich mute object: value + audit metadata). Carries the same shape as a sender/account/mailbox MutedFlag so a relocated mute flag survives unchanged.")
model MutedFlagSetting extends AccountSettingValue {
  kind: "MutedFlag";
  value: MutedFlag;
}

@doc("Concrete setting values, one variant per `kind`. Persisted as an opaque map (the registry validates the shape per setting name); the discriminator above types it on the wire.")
union AccountSettingValueUnion {
  boolean: BooleanSetting,
  string: StringSetting,
  number: NumberSetting,
  stringList: StringListSetting,
  map: MapSetting,
  mutedFlag: MutedFlagSetting,
}

@doc("A single user setting for an account configuration. One row per (accountConfigId, name); the primary key is a deterministic UUID v5 of that pair, so writes are idempotent upserts.")
@entity("accountSetting", "remit")
@index(
  "AccountSetting",
  {
    pk: [AccountSetting.accountSettingId],
    sk: [],
  }
)
@index(
  "byAccountConfigId",
  {
    index: "gsi0",
    pk: [AccountSetting.accountConfigId],
    sk: [AccountSetting.name],
  }
)
model AccountSetting {
  @doc("Primary identifier: UUID v5 derived from accountConfigId + name")
  @visibility(Lifecycle.Read)
  accountSettingId: UUID;

  @doc("Owning account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Setting key. Either a closed `AccountSettingName` member (e.g. `Theme`) or, for a per-target setting, a composite `<AccountSettingName>#<targetId>` (e.g. `AccountSignaturePlainText#<accountId>`). The registry resolves the base member and maps it to its required value kind and a zod schema.")
  name: string;

  @doc("Typed setting value")
  value: AccountSettingValueUnion;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
