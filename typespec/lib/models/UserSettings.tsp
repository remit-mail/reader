import "@typespec/http";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  The caller's own settings: choices that belong to the person rather than to
  one mail account. Each field is stored as an `AccountSetting` row of the
  account config and read back here, so a setting added later is one more
  field on this resource rather than one more operation.
  """)
model UserSettingsResponse {
  @doc("The account calendar invitations, updates and cancellations go out from unless the event editor picks another: the one the reader chose while it still sends mail, otherwise the account an event is on — for a new event, the first account of the account config that sends mail, since a calendar belongs to the account config rather than to one account. Absent only when no account sends mail.")
  defaultInvitationSenderAccountId?: UUID;

  @doc("Whether `defaultInvitationSenderAccountId` is the reader's own choice rather than the account an event is on.")
  defaultInvitationSenderChosen: boolean;

  @doc("Every classification provider the reader can pick.")
  classificationPresets: ClassificationPreset[];

  @doc("The saved classification provider, or `NotConfigured`.")
  classification: ClassificationSettings;
}

@doc("A change to the caller's settings. Every field is optional and absence means untouched.")
model UpdateUserSettingsInput {
  @doc("The account invitations go out from by default. Refused with 400 `unknown_sender` when it is not an account of the caller's account config that sends mail. Cleared with `clearDefaultInvitationSender`.")
  defaultInvitationSenderAccountId?: UUID;

  @doc("Save a classification provider. Saving another preset deletes the stored key. Without it, the classification fields below apply to the saved provider.")
  classificationPresetId?: ClassificationPresetId;

  @doc("The model to ask for. Empty means the preset's default model.")
  classificationModel?: string;

  @doc("The http or https base URL to call. Empty means the preset's default base URL. Refused with 400 `invalid_classification_base_url` when it is not a URL, or when the preset has no default base URL and none is given.")
  classificationBaseUrl?: string;

  @doc("The provider's API key. Write-only: stored encrypted and never returned. Refused with 400 `classification_api_key_required` when the preset needs a key and none is stored for it.")
  classificationApiKey?: string;

  @doc("Switch classification on or off. Switching on with no saved provider is refused with 400 `classification_not_configured`; switching off keeps the provider and key.")
  classificationEnabled?: boolean;

  @doc("The most classification calls per mail account per UTC day. Needs a saved provider.")
  @minValue(1)
  classificationDailyLimit?: int32;
}

@doc("A classification preset that has a known price per million input tokens.")
model ClassificationPriced {
  state: "Priced";

  @doc("ISO 4217 currency of `perMillionInputTokens`.")
  currency: "USD";

  @doc("Price of one million input tokens. Output tokens are not charged.")
  perMillionInputTokens: float64;
}

@doc("A classification preset with no price to show: self-hosted, or a price the provider sets per model.")
model ClassificationNoPrice {
  state: "NoPrice";
}

union ClassificationPrice {
  priced: ClassificationPriced,
  noPrice: ClassificationNoPrice,
}

@doc("A classification provider the reader can pick.")
model ClassificationPreset {
  presetId: ClassificationPresetId;
  label: string;
  group: ClassificationPresetGroup;
  adapterShape: ClassificationAdapterShape;

  @doc("The base URL used when the reader leaves it empty. Absent when a save has to name one in `classificationBaseUrl`.")
  defaultBaseUrl?: string;

  @doc("The model used when the reader leaves it empty.")
  defaultModel: string;

  @doc("Whether a save needs `classificationApiKey`.")
  needsKey: boolean;

  price: ClassificationPrice;
}

@doc("No classification provider is saved, so classification is off.")
model ClassificationNotConfigured {
  state: "NotConfigured";
}

@doc("The saved classification provider. The API key itself is never returned.")
model ClassificationConfigured {
  state: "Configured";
  presetId: ClassificationPresetId;
  `model`: string;
  baseUrl: string;

  @doc("Whether an API key is stored for this provider.")
  apiKeySaved: boolean;

  @doc("Whether classification runs.")
  enabled: boolean;

  @doc("The most classification calls per mail account per UTC day.")
  dailyLimit: int32;

  @doc("When the provider, model, base URL or key was last saved, in epoch milliseconds (UTC).")
  savedAt: int64;

  @doc("Today's provider calls, one row per mail account of the account config.")
  usage: ClassificationUsage[];
}

@doc("The cost of today's calls, counting each call as 1,500 input tokens at the preset's price.")
model ClassificationCostPriced {
  state: "Priced";

  @doc("ISO 4217 currency of `amount`.")
  currency: "USD";

  amount: float64;
}

union ClassificationCost {
  priced: ClassificationCostPriced,
  noPrice: ClassificationNoPrice,
}

@doc("One mail account's classification calls today.")
model ClassificationUsage {
  accountId: UUID;

  @doc("Provider calls made today (UTC). Test calls do not count.")
  calls: int32;

  @doc("The most calls this mail account makes per UTC day.")
  dailyLimit: int32;

  @doc("When `calls` restarts at zero: the next 00:00 UTC.")
  resetsAt: utcDateTime;

  cost: ClassificationCost;
}

union ClassificationSettings {
  notConfigured: ClassificationNotConfigured,
  configured: ClassificationConfigured,
}

@doc("The classification provider form as it stands, saved or not.")
model ClassificationTestInput {
  presetId: ClassificationPresetId;

  @doc("The model to ask for. Empty means the preset's default model.")
  `model`: string;

  @doc("The http or https base URL to call. Empty means the preset's default base URL.")
  baseUrl: string;

  @doc("The provider's API key. Empty means the key saved for this preset.")
  apiKey: string;
}

@doc("The provider classified the sample message.")
model ClassificationTestPassed {
  state: "Passed";

  @doc("How long the provider call took, in milliseconds.")
  latencyMs: int32;

  @doc("The label the provider chose for the sample message.")
  label: ClassificationLabel;

  @doc("The provider's confidence in `label`, between 0 and 1.")
  confidence: float64;
}

@doc("The provider call gave no usable answer.")
model ClassificationTestFailed {
  state: "Failed";

  @doc("How long the provider call took, in milliseconds.")
  latencyMs: int32;

  @doc("The HTTP status the provider answered with. Absent when no answer arrived.")
  status?: int32;

  kind: ClassificationFailureKind;

  @doc("The form field to change. Absent when no field can fix it: a rate limit or a provider error.")
  field?: ClassificationField;

  @doc("What to change so the next test passes.")
  fix: string;
}

union ClassificationTestResponse {
  passed: ClassificationTestPassed,
  failed: ClassificationTestFailed,
}
