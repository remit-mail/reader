import "../scalars/string.tsp";
import "../enums/MessageCategory.tsp";

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

@doc("A single semantic-search hit. Display fields (fromName, subject, sentDate) are denormalized at index time and present for messages indexed after this feature was deployed. Older entries may omit them; clients should render a fallback when absent.")
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

  @doc("Display name of the sender (From header). Present for messages indexed after display-field enrichment was deployed.")
  fromName?: string;

  @doc("Message subject. Present for messages indexed after display-field enrichment was deployed.")
  subject?: string;

  @doc("Sent date as Unix epoch seconds. Present for messages indexed after display-field enrichment was deployed.")
  sentDate?: int64;

  @doc("Header-derived category of the matched message. Present for messages indexed after category enrichment was deployed; older entries omit it.")
  category?: MessageCategory;
}
