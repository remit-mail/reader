namespace RemitImap;

@doc("A classification provider preset: a known provider with its adapter shape, default base URL and default model.")
enum ClassificationPresetId {
  Jev: "Jev",
  Jina: "Jina",
  Mistral: "Mistral",
  Gemini: "Gemini",
  OpenAiCompatible: "OpenAiCompatible",
  Local: "Local",
}
