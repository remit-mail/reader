@doc("Standard header field names defined in RFC 2822 Section 3.6")
enum StandardHeaderField {
  @doc("Origination date - RFC 2822 Section 3.6.1 - REQUIRED")
  Date: "Date",

  @doc("Message author(s) - RFC 2822 Section 3.6.2 - REQUIRED")
  From: "From",

  @doc("Actual sender - RFC 2822 Section 3.6.2")
  Sender: "Sender",

  @doc("Reply destination - RFC 2822 Section 3.6.2")
  ReplyTo: "Reply-To",

  @doc("Primary recipients - RFC 2822 Section 3.6.3")
  To: "To",

  @doc("Carbon copy recipients - RFC 2822 Section 3.6.3")
  Cc: "Cc",

  @doc("Blind carbon copy recipients - RFC 2822 Section 3.6.3")
  Bcc: "Bcc",

  @doc("Unique message identifier - RFC 2822 Section 3.6.4")
  MessageId: "Message-ID",

  @doc("Parent message identifier(s) - RFC 2822 Section 3.6.4")
  InReplyTo: "In-Reply-To",

  @doc("Thread message identifiers - RFC 2822 Section 3.6.4")
  References: "References",

  @doc("Message topic - RFC 2822 Section 3.6.5")
  Subject: "Subject",

  @doc("Additional comments - RFC 2822 Section 3.6.5")
  Comments: "Comments",

  @doc("Important words/phrases - RFC 2822 Section 3.6.5")
  Keywords: "Keywords",

  @doc("Envelope return address - RFC 2822 Section 3.6.7")
  ReturnPath: "Return-Path",

  @doc("Transport hop information - RFC 2822 Section 3.6.7")
  Received: "Received",

  @doc("Resent date - RFC 2822 Section 3.6.6")
  ResentDate: "Resent-Date",

  @doc("Resent author - RFC 2822 Section 3.6.6")
  ResentFrom: "Resent-From",

  @doc("Resent sender - RFC 2822 Section 3.6.6")
  ResentSender: "Resent-Sender",

  @doc("Resent primary recipients - RFC 2822 Section 3.6.6")
  ResentTo: "Resent-To",

  @doc("Resent CC recipients - RFC 2822 Section 3.6.6")
  ResentCc: "Resent-Cc",

  @doc("Resent BCC recipients - RFC 2822 Section 3.6.6")
  ResentBcc: "Resent-Bcc",

  @doc("Resent message identifier - RFC 2822 Section 3.6.6")
  ResentMessageId: "Resent-Message-ID",
}

@doc("Common MIME header fields per RFC 2045")
enum MimeHeaderField {
  @doc("MIME version")
  MimeVersion: "MIME-Version",

  @doc("Content type and parameters")
  ContentType: "Content-Type",

  @doc("Content transfer encoding")
  ContentTransferEncoding: "Content-Transfer-Encoding",

  @doc("Content identifier")
  ContentId: "Content-ID",

  @doc("Content description")
  ContentDescription: "Content-Description",

  @doc("Content disposition")
  ContentDisposition: "Content-Disposition",

  @doc("Content location URI")
  ContentLocation: "Content-Location",

  @doc("Content language")
  ContentLanguage: "Content-Language",
}

@doc("Union type for header field names: RFC 2822 standard, MIME headers, or custom/extension headers")
union HeaderFieldName {
  @doc("RFC 2822 standard header field")
  standard: StandardHeaderField,

  @doc("MIME header field")
  mime: MimeHeaderField,

  @doc("Custom or extension header field (typically starts with X-)")
  custom: string,
}
