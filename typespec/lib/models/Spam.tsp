import "../enums/AuthResultVerdict.tsp";
import "../enums/ProviderSpamVerdict.tsp";
import "../enums/SpamAction.tsp";
import "../enums/SpamFailureKind.tsp";
import "../enums/SpamKind.tsp";
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

  @doc("The sending server's IP: the hop the provider's SPF check judged, else the first hop from a public address, or empty.")
  ip: string;

  @doc("The HELO name the sending server gave, or empty.")
  helo: string;

  @doc("The sending server's reverse DNS name as the receiving server recorded it, or empty.")
  hostname: string;
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
