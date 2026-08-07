namespace RemitImap;

@doc("""
  Why the server refused a file uploaded to a draft.
  
  Closed rather than free text: the composer renders its own copy for each
  member (naming the file, the size and the cap), so a refusal must be
  distinguishable from a network failure without parsing prose.
  """)
enum OutboxAttachmentRejectionReason {
  @doc("The request body is not a readable `multipart/form-data` payload.")
  MalformedUpload: "MalformedUpload",

  @doc("The payload carries no `file` part.")
  MissingFile: "MissingFile",

  @doc("The file part carries no bytes.")
  EmptyFile: "EmptyFile",

  @doc("Nothing usable survives sanitizing the supplied filename.")
  UnusableFilename: "UnusableFilename",

  @doc("This one file is larger than the per-message cap.")
  FileTooLarge: "FileTooLarge",

  @doc("The file fits on its own, but pushes the draft's total over the cap.")
  MessageTooLarge: "MessageTooLarge",

  @doc("The draft already holds as many files as one message may carry.")
  TooManyAttachments: "TooManyAttachments",
}
