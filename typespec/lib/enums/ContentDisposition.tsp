@doc("Content disposition types per RFC 2183")
enum ContentDisposition {
  @doc("Content should be displayed inline")
  Inline: "inline",

  @doc("Content should be downloaded as attachment")
  Attachment: "attachment",
}
