import "../enums/AuthResultVerdict.tsp";
import "../enums/ProviderSpamVerdict.tsp";
import "../enums/SpamAction.tsp";
import "../enums/SpamFailureKind.tsp";
import "../enums/SpamKind.tsp";
import "../enums/SpamLabelPlacement.tsp";
import "../enums/SpamReasonName.tsp";
import "../enums/SpamSenderScreenRule.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("One header line, name and unfolded value.")
model SpamHeader {
  name: string;
  value: string;
}

@doc("One link in the message body: where it points, and the text the reader sees.")
model SpamLink {
  href: string;
  text: string;
}

@doc("The message as Remit parsed it once, so a backend needs no MIME parser.")
model SpamRequestMessage {
  @doc("The RFC 822 message, base64.")
  raw: string;

  headers: SpamHeader[];
  text: string;
  html: string;
  links: SpamLink[];
}

@doc("Envelope facts, as rspamd's `/checkv2` takes them.")
model SpamRequestEnvelope {
  @doc("The Return-Path address, or empty.")
  mailFrom: string;

  @doc("The account's own addresses.")
  rcpt: string[];

  @doc("The connecting IP from the receiving server's Received header, or empty.")
  ip: string;

  @doc("The HELO name from the receiving server's Received header, or empty.")
  helo: string;
}

@doc("The provider's authentication results, read from its Authentication-Results.")
model SpamRequestAuthentication {
  dmarc: AuthResultVerdict;
  spf: AuthResultVerdict;
  dkim: AuthResultVerdict;

  @doc("Registrable domain of the first passing DKIM signature, or `unverified` when no signature passed.")
  signerDomain: string;

  @doc("The SPF-checked envelope domain, or empty.")
  envelopeDomain: string;
}

@doc("The owner's mail provider's own spam verdict.")
model SpamRequestProvider {
  verdict: ProviderSpamVerdict;

  @doc("The score the provider's header carries, or empty.")
  score: string;

  @doc("X-Spam-* and the like.")
  headers: SpamHeader[];
}

@doc("What Remit knows about the sender and the account. The spam service never reads Remit's database, so every fact it weighs arrives here.")
model SpamRequestContext {
  @doc("The owner has sent mail to this address.")
  knownSender: boolean;

  @doc("Earlier messages from this address.")
  senderMessagesSeen: int32;

  @doc("Earlier messages from the address's registrable domain.")
  senderDomainMessagesSeen: int32;

  @doc("ISO 8601 date-time with offset the sender's registrable domain was registered, from RDAP. Absent when the registry publishes none or the lookup failed; Remit never fills in a placeholder.")
  senderDomainRegisteredAt?: string;

  @doc("ISO 8601 date-time with offset the receiving server took the message (INTERNALDATE). Domain age is measured against it, so the judge stays a function of the request.")
  receivedAt: string;

  @doc("The category classifier's answer, or empty.")
  classifierScores: ClassifierScore[];

  @doc("The account has a model and is under its daily cap.")
  modelAllowed: boolean;
}

@doc("Everything a spam service weighs for one message (RFC 041). The shape follows rspamd's `/checkv2`: the raw message plus envelope facts as named fields.")
model SpamRequest {
  message: SpamRequestMessage;
  envelope: SpamRequestEnvelope;
  authentication: SpamRequestAuthentication;
  provider: SpamRequestProvider;
  context: SpamRequestContext;
}

@doc("One check that found something, shaped like an rspamd symbol.")
model SpamReason {
  name: SpamReasonName;

  @doc("The backend's own name for the check, as rspamd names a symbol. The inline engine uses `name`; a backend whose symbol has no `SpamReasonName` sends `BackendSymbol` and its raw symbol here.")
  symbol: string;

  @doc("What the check added to the score.")
  score: float64;

  @doc("What the check found, such as the domain behind a link.")
  options: string[];
}

@doc("A spam service weighed the message.")
model SpamChecked {
  state: "Checked";

  @minValue(0)
  @maxValue(1)
  score: float64;

  action: SpamAction;
  kind: SpamKind;
  reasons: SpamReason[];

  @doc("The service called a model, so Remit counts the call against the daily cap.")
  modelCalled: boolean;
}

@doc("A spam service gave no verdict.")
model SpamFailed {
  state: "Failed";
  kind: SpamFailureKind;
}

@doc("A spam service's answer (RFC 041).")
union SpamResponse {
  checked: SpamChecked,
  failed: SpamFailed,
}

@doc("The sender's standing let the message through.")
model SpamScreenBySender {
  rule: SpamSenderScreenRule;
}

@doc("One of the owner's filters matched the message.")
model SpamScreenByFilter {
  rule: "Filter";
  filterId: UUID;
}

@doc("The stage 1 rule that let a message through without a spam check.")
union SpamScreen {
  sender: SpamScreenBySender,
  filter: SpamScreenByFilter,
}

@doc("No spam check has run on this message.")
model SpamVerdictNotChecked {
  state: "NotChecked";
}

@doc("Stage 1 let the message through without a call to the spam service.")
model SpamVerdictScreenedOut {
  state: "ScreenedOut";
  screen: SpamScreen;
}

@doc("The spam outcome stored on a message.")
union MessageSpamVerdict {
  notChecked: SpamVerdictNotChecked,
  screenedOut: SpamVerdictScreenedOut,
  checked: SpamChecked,
  failed: SpamFailed,
}

@doc("No thresholds are set, so every verdict's action is `None` and nothing moves.")
model SpamThresholdsUnset {
  state: "Unset";
}

@doc("The two scores that turn a spam score into an action: below `cleanBelow` nothing happens, from `spamAt` up the message goes to Junk, and between the two the owner is warned.")
model SpamThresholdsSet {
  state: "Set";

  @minValue(0)
  @maxValue(1)
  cleanBelow: float64;

  @minValue(0)
  @maxValue(1)
  spamAt: float64;
}

@doc("The thresholds a spam service compares a score with (RFC 041). Calibration sets them.")
union SpamThresholds {
  unset: SpamThresholdsUnset,
  set: SpamThresholdsSet,
}

@doc("How Remit acts on spam verdicts for the caller.")
model SpamSettings {
  @doc("The thresholds in effect. They come from the deployment (`SPAM_CLEAN_BELOW` and `SPAM_AT`).")
  thresholds: SpamThresholds;

  @doc("What a `Junk` verdict of kind `Spam` does.")
  spamPlacement: SpamLabelPlacement;

  @doc("What a `Junk` verdict of kind `Phishing` does.")
  phishingPlacement: SpamLabelPlacement;
}

@doc("Spam verdicts on mail that arrived on one day, for one action and kind.")
model SpamDayCount {
  @doc("The arrival day, YYYY-MM-DD, in the zone offset of `since`.")
  date: string;

  @doc("`Warn` or `Junk`: the judge's action, before the owner's per-label setting.")
  action: SpamAction;

  kind: SpamKind;
  count: int32;
}

@doc("Checked messages whose spam score falls in one band, `from` inclusive to `from + 0.05` exclusive; the last band includes 1.")
model SpamScoreBand {
  @minValue(0)
  @maxValue(1)
  from: float64;

  count: int32;
}
