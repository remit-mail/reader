namespace RemitImap;

@doc("Address roles in message headers per RFC 2822 Sections 3.6.2 and 3.6.3")
enum AddressRole {
  @doc("Message author(s) - RFC 2822 Section 3.6.2")
  From: "from",

  @doc("Actual sender if different from author - RFC 2822 Section 3.6.2")
  Sender: "sender",

  @doc("Reply destination - RFC 2822 Section 3.6.2")
  ReplyTo: "reply_to",

  @doc("Primary recipient(s) - RFC 2822 Section 3.6.3")
  To: "to",

  @doc("Carbon copy recipient(s) - RFC 2822 Section 3.6.3")
  Cc: "cc",

  @doc("Blind carbon copy recipient(s) - RFC 2822 Section 3.6.3")
  Bcc: "bcc",
}
