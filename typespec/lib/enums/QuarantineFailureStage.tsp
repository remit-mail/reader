namespace RemitImap;

@doc("""
  The pipeline step that refused a quarantined message.
  
  A member exists only where a catch site can tell a message defect from an
  infrastructure failure. Both members sit behind that narrowing: the body
  parse is its own try block around the `simpleParser` call and nothing else,
  and the envelope check reads a field that arrived on the FETCH result. What a
  wider frame catches — S3, the queue, the database — propagates and is never
  written here.
  """)
enum QuarantineFailureStage {
  @doc("Parsing the fetched message body.")
  BodyParse: "BodyParse",

  @doc("Reading the message's ENVELOPE off the FETCH result.")
  MessageEnvelope: "MessageEnvelope",
}
