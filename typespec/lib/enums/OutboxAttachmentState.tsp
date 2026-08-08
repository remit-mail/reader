namespace RemitImap;

@doc("""
  Where an attachment is between being promised and being sendable.
  
  There is no third state and no absence: a row exists from the moment room is
  claimed, so the cap can be enforced against rows in one transaction rather
  than against bytes that may or may not have landed yet.
  """)
enum OutboxAttachmentState {
  @doc("Room is claimed and an upload URL is outstanding. Lapses at `expiresAt`.")
  Pending: "Pending",

  @doc("The bytes are in storage at the size that was claimed. Sendable.")
  Stored: "Stored",
}
