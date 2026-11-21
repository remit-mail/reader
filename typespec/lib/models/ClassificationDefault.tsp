namespace RemitImap;

@doc("Where the deployment classification default comes from.")
enum ClassificationDefaultSource {
  @doc("The deployment configuration, or no configured default.")
  Config: "Config",

  @doc("A value saved by an operator.")
  Operator: "Operator",
}

@doc("The deployment classification default. The provider key is never returned.")
model ClassificationDefaultResponse {
  presetId: ClassificationPresetId | null;
  `model`: string | null;
  baseUrl: string | null;
  enabled: boolean;
  dailyLimit: int32;
  hasKey: boolean;
  source: ClassificationDefaultSource;
}

@doc("A replacement deployment classification default. An empty API key keeps the existing key.")
model PutClassificationDefaultInput {
  presetId: ClassificationPresetId;
  `model`: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  dailyLimit: int32;
}
