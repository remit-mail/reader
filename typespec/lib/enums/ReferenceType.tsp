namespace RemitImap;

@doc("Message reference types per RFC 2822 Section 3.6.4")
enum ReferenceType {
  @doc("In-Reply-To header - identifies parent message(s)")
  InReplyTo: "in_reply_to",

  @doc("References header - identifies thread messages")
  References: "references",
}
