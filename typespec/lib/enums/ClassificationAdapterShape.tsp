namespace RemitImap;

@doc("The request shape a classification provider speaks. `DecisionApi` returns a calibrated probability per label; `ChatJsonSchema` is an OpenAI-compatible chat completion constrained to the label enum; `JinaClassify` is Jina's `/v1/classify`.")
enum ClassificationAdapterShape {
  DecisionApi: "DecisionApi",
  ChatJsonSchema: "ChatJsonSchema",
  JinaClassify: "JinaClassify",
}
