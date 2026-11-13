namespace RemitImap;

@doc("Messages per category, one count for every `MessageCategory`.")
model ClassifierCategoryCounts {
  uncategorized: int32;
  personal: int32;
  newsletter: int32;
  marketing: int32;
  automated: int32;
  transactional: int32;
  social: int32;
  coldOutreach: int32;
}

@doc("Confident scores per label, one count for every `ClassificationLabel`.")
model ClassifierLabelCounts {
  Spam: int32;
  Phishing: int32;
  Priority: int32;
  Personal: int32;
  Newsletter: int32;
  Marketing: int32;
  Automated: int32;
  Transactional: int32;
  Social: int32;
  ColdOutreach: int32;
}

@doc("Times the reader disagreed with the classifier since `since`.")
model ClassifierCorrections {
  @doc("Messages the reader reported as spam whose stored scores held no confident `Spam` or `Phishing` score.")
  spamReportedNotJunk: int32;

  @doc("Senders whose `Address.flags.category` override was set on or after `since`.")
  categoryOverridden: int32;
}

@doc("The classifier's distribution and corrections over mail that arrived on or after `since`, across every account the caller holds.")
model ClassifierStats {
  @doc("The start of the window, as the request gave it: an ISO 8601 date-time with zone offset.")
  since: string;

  @doc("Messages that arrived on or after `since` whose body sync classified them.")
  examined: int32;

  @doc("Examined messages per category.")
  byCategory: ClassifierCategoryCounts;

  @doc("Confident scores per label, over the examined messages.")
  byLabel: ClassifierLabelCounts;

  corrections: ClassifierCorrections;
}
