namespace RemitImap;

@doc("""
  The pipeline step that refused a quarantined message.
  
  One member. No catch site on the sync path can currently tell a parse failure
  from an infrastructure failure: the per-message frame in `body-sync.ts` wraps
  the S3 body write, the parsed-body cache write, the body-part upserts, the
  placement move and the label and counter writes alongside the `simpleParser`
  call, and filters only connection drops out of it. A stage is added when a
  try block is narrowed far enough to attribute it, never ahead of that — an
  enum member that reached stored rows cannot be walked back.
  """)
enum QuarantineFailureStage {
  @doc("Parsing the fetched message body.")
  BodyParse: "BodyParse",
}
