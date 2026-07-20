namespace RemitImap;

@doc("""
  The pipeline step that refused a quarantined message.
  
  One member, and it is behind a real narrowing rather than a promise of one:
  the body parse has its own try block around the parse call and nothing else,
  so an error out of it can only be the message. S3, queue and database
  failures propagate and never become a record here — quarantining one would
  set a message aside for an outage, tell the user it was unreadable, and
  invite a public GitHub issue about it.
  
  A message that arrives with no ENVELOPE is deliberately NOT a member. Nothing
  can tell that apart from the FETCH row glitching (#408), and the IMAP client
  is far more often the cause than the message; the sync path holds its cursor
  and retries instead, so a transient glitch heals and a persistent one trips
  the stalled-cursor alert.
  """)
enum QuarantineFailureStage {
  @doc("Parsing the fetched message body.")
  BodyParse: "BodyParse",
}
