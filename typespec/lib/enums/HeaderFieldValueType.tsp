namespace RemitImap;

@doc("Header field value types for parsing guidance per RFC 2822")
enum HeaderFieldValueType {
  @doc("Date and time specification - RFC 2822 Section 3.3")
  DateTime: "date_time",

  @doc("Comma-separated list of mailboxes - RFC 2822 Section 3.4")
  MailboxList: "mailbox_list",

  @doc("Single mailbox - RFC 2822 Section 3.4")
  Mailbox: "mailbox",

  @doc("Comma-separated list of addresses (mailbox or group) - RFC 2822 Section 3.4")
  AddressList: "address_list",

  @doc("Message identifier - RFC 2822 Section 3.6.4")
  MsgId: "msg_id",

  @doc("List of message identifiers - RFC 2822 Section 3.6.4")
  MsgIdList: "msg_id_list",

  @doc("Unstructured text - RFC 2822 Section 2.2.1")
  Unstructured: "unstructured",

  @doc("Comma-separated list of phrases - RFC 2822 Section 3.6.5")
  PhraseList: "phrase_list",

  @doc("Return path specification - RFC 2822 Section 3.6.7")
  Path: "path",

  @doc("Received header format - RFC 2822 Section 3.6.7")
  Received: "received",
}
