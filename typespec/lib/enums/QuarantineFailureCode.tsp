namespace RemitImap;

@doc("""
  The specific defect within a stage.
  
  Closed rather than free text: this is the one diagnostic that is interpolated
  into the title of an issue filed under the user's own GitHub account, so its
  publishability has to be a property of the type instead of a claim about the
  writer. Grows with the same narrowing that grows QuarantineFailureStage.
  """)
enum QuarantineFailureCode {
  @doc("A multipart boundary was opened and never closed.")
  UnterminatedMultipartBoundary: "UnterminatedMultipartBoundary",

  @doc("The declared charset is not an encoding the parser knows.")
  UnknownCharset: "UnknownCharset",

  @doc("The body ended before the declared length.")
  TruncatedBody: "TruncatedBody",
}
