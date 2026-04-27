import "../scalars/string.tsp";

namespace RemitImap;

@doc("Allowed chunk types that may be the best match for a semantic-search hit")
enum SemanticSearchChunkType {
  sender,
  recipient,
  subject,
  attachment,
  body,
  entities,
}

@doc("A single semantic-search hit. Refers to a message by id; the client resolves full message details separately.")
model SemanticSearchResult {
  @doc("Matched message id")
  messageId: UUID;

  @doc("Thread id the matched message belongs to")
  threadId: UUID;

  @doc("Cosine similarity (or backend-equivalent) of the best matching chunk for this message; higher is more relevant")
  score: float64;

  @doc("Chunk type that produced the best match for this message")
  matchedChunkType: SemanticSearchChunkType;

  @doc("All mailbox ids the matched message currently lives in")
  mailboxIds: UUID[];
}
