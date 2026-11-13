import "../enums/RescanFailureCode.tsp";
import "../scalars/string.tsp";
import "./Spam.tsp";

namespace RemitImap;

@doc("Messages to check again for spam and category (RFC 041).")
model RescanInput {
  @doc("The messages to check, all in the account the path names. At most 10 per call; a backfill sends ten per call.")
  @minItems(1)
  @maxItems(10)
  messageIds: UUID[];

  @doc("Also apply placement, moving a message the verdict sends to Junk. Without it a rescan writes verdicts, scores and labels only.")
  move?: boolean = false;
}

@doc("One message the rescan checked.")
model RescanSuccess {
  messageId: UUID;
  verdict: MessageSpamVerdict;

  @doc("Names of the labels the rescan applied to the message.")
  labels: string[];
}

@doc("One message the rescan left unchecked.")
model RescanFailure {
  messageId: UUID;
  code: RescanFailureCode;

  @doc("Whether the same id may succeed on a later call: true for `RateLimited` and `DailyCap`.")
  retryable: boolean;
}

@doc("The outcome per message, as SQS `SendMessageBatch` answers. The call succeeds when some messages fail.")
model RescanResult {
  successful: RescanSuccess[];
  failed: RescanFailure[];
}
