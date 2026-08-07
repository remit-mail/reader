namespace RemitImap;

@doc("""
  Why the server refused to reserve, or to accept, a file for a draft.
  
  Closed rather than free text: the composer renders its own copy for each
  member (naming the file, the size and the cap), so a refusal must be
  distinguishable from a network failure without parsing prose.
  """)
enum OutboxAttachmentRejectionReason {
  @doc("The declared size is zero — there would be nothing to attach.")
  EmptyFile: "EmptyFile",

  @doc("Nothing usable survives sanitizing the supplied filename.")
  UnusableFilename: "UnusableFilename",

  @doc("This one file is larger than the per-message cap.")
  FileTooLarge: "FileTooLarge",

  @doc("The file fits on its own, but pushes the draft's total over the cap.")
  MessageTooLarge: "MessageTooLarge",

  @doc("The draft already holds as many files as one message may carry.")
  TooManyAttachments: "TooManyAttachments",

  @doc("The reservation has expired or was never made. Ask for a new upload URL.")
  ReservationExpired: "ReservationExpired",

  @doc("Nothing was uploaded against the reservation. The bytes never arrived.")
  UploadMissing: "UploadMissing",

  @doc("The stored object is not the size that was reserved for it.")
  SizeMismatch: "SizeMismatch",
}
