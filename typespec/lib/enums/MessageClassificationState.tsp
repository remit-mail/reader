namespace RemitImap;

@doc("Whether the header classifier has examined a message's body (issue #331). Persistence-level state on `Message`, deliberately off the wire: no response model carries it. It exists because `category` cannot answer this question — `uncategorized` is both the value a metadata-synced row starts at and the answer the classifier gives when it has nothing to say, so a guard reading `category` alone cannot tell \"never examined\" from \"examined and declined\" and re-reads the stored body on every sync pass forever.")
enum MessageClassificationState {
  @doc("The classifier has never run over this message's body. The default, and what every message written before this field existed carries. Named pending state, never inferred from absence — the same reason `AuthenticityVerdict.NotEvaluated` exists.")
  NotExamined: "NotExamined",

  @doc("The classifier ran over this message's body and `category` holds its answer, `uncategorized` included. Nothing revisits such a message on an ordinary sync pass; reaching this cohort again — after a classifier release that would now categorize it — is a deliberate backfill over this field.")
  Examined: "Examined",
}
