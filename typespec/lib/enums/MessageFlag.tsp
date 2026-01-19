namespace RemitImap;

@doc("System message flags defined in RFC 9051 Section 2.3.2 - MUST be supported by all servers")
enum MessageSystemFlag {
  @doc("Message has been read")
  Seen: "\\Seen",

  @doc("Message has been answered")
  Answered: "\\Answered",

  @doc("Message is flagged for urgent/special attention")
  Flagged: "\\Flagged",

  @doc("Message is marked for deletion")
  Deleted: "\\Deleted",

  @doc("Message is a draft")
  Draft: "\\Draft",
}

@doc("Common keyword flags (non-system flags) for messages - widely supported but not required")
enum MessageKeywordFlag {
  @doc("Message has been forwarded")
  Forwarded: "$Forwarded",

  @doc("Message Disposition Notification has been sent")
  MDNSent: "$MDNSent",

  @doc("Message is identified as junk/spam")
  Junk: "$Junk",

  @doc("Message is identified as not junk")
  NotJunk: "$NotJunk",

  @doc("Message is identified as phishing attempt")
  Phishing: "$Phishing",
}

@doc("Union type for message flags: system flags, common keywords, or custom keywords")
union MessageFlagValue {
  @doc("RFC 9051 system flag")
  systemFlag: MessageSystemFlag,

  @doc("Common keyword flag")
  keywordFlag: MessageKeywordFlag,

  @doc("Custom user-defined keyword (must not start with backslash)")
  customKeyword: string,
}
