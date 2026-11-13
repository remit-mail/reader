namespace RemitImap;

@doc("A label a classification provider picks for a message: the junk verdicts, priority, and the message categories.")
enum ClassificationLabel {
  Spam: "Spam",
  Phishing: "Phishing",
  Priority: "Priority",
  Personal: "Personal",
  Newsletter: "Newsletter",
  Marketing: "Marketing",
  Automated: "Automated",
  Transactional: "Transactional",
  Social: "Social",
  ColdOutreach: "ColdOutreach",
}
