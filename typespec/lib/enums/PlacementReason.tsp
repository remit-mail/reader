namespace RemitImap;

@doc("A signal a placement verdict was based on. The values are the strings stored verdicts carry, so retired members stay: a verdict recorded before the rule changed still reads back.")
enum PlacementReason {
  @doc("The user blocked the sender.")
  SenderBlocked: "sender=blocked",

  @doc("Retired: the sender was neither Vip nor Wellknown.")
  SenderUntrusted: "sender=untrusted",

  @doc("The user marked the sender never-spam.")
  SenderNeverSpam: "sender=never-spam",

  @doc("The sender is a Vip.")
  SenderVip: "sender=vip",

  @doc("The sender is Wellknown.")
  SenderWellknown: "sender=wellknown",

  @doc("The classifier or the spam service judged the message junk.")
  ClassifierSpam: "classifier=spam",

  @doc("A spam judge called the message clean.")
  SpamClean: "spam=clean",

  @doc("Retired: the provider filed the message as spam.")
  ProviderSpam: "provider=spam",

  @doc("Retired: the DKIM signature did not match the From domain.")
  DkimMismatch: "dkim-mismatch",

  @doc("Retired: the From domain failed DMARC.")
  DmarcFail: "dmarc=fail",

  @doc("Retired: the From domain passed DMARC.")
  DmarcPass: "dmarc=pass",

  @doc("Retired: the verdict was left to the language model.")
  DeferredToLlm: "deferred-to-llm",

  @doc("Retired: the message lacked the signals a verdict needs.")
  MissingSignals: "missing-signals",

  @doc("No signal was strong enough to act on.")
  NoConfidentSignal: "no-confident-signal",

  @doc("A spam report or a user move already placed the message in Junk.")
  PlacedInJunk: "placed-in-junk",

  @doc("Remit already moved the message once.")
  AlreadyMovedByRemit: "already-moved-by-remit",

  @doc("Retired: the message body could not be read.")
  BodyUnreadable: "body-unreadable",

  @doc("A rescue found no reason to bring the message out of Junk.")
  JunkNotRescued: "junk-not-rescued",
}
