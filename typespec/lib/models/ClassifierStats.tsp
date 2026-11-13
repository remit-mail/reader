namespace RemitImap;

@doc("Examined messages in one category.")
model ClassifierCategoryCount {
  category: MessageCategory;
  count: int32;
}

@doc("Confident scores for one label.")
model ClassifierLabelCount {
  label: ClassificationLabel;
  count: int32;
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

  @doc("Examined messages per category; a category with none is absent.")
  byCategory: ClassifierCategoryCount[];

  @doc("Confident scores per label, over the examined messages; a label with none is absent.")
  byLabel: ClassifierLabelCount[];

  corrections: ClassifierCorrections;
}
