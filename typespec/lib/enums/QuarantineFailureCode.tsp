namespace RemitImap;

@doc("""
  The specific defect within a stage.
  
  Closed rather than free text: this is the one diagnostic that is interpolated
  into the title of an issue filed under the user's own GitHub account, so its
  publishability has to be a property of the type instead of a claim about the
  writer.
  
  The vocabulary is total — every quarantine write picks a member, and a defect
  the writer cannot name is `UnreadableBody` rather than an invented code. It
  is deliberately small: the body parser reports its refusals as free text with
  no stable type or code, so a member exists only where the writer can identify
  the defect without reading parser prose. `UnterminatedMultipartBoundary` and
  `TruncatedBody` were provisional members carried by Phase 2 and are gone —
  nothing on the narrowed sync path could produce either, and a member no
  writer can reach is a vocabulary that lies about what the field means.
  `MissingEnvelope` is absent for the same reason: see QuarantineFailureStage.
  """)
enum QuarantineFailureCode {
  @doc("The declared charset is not an encoding the parser knows. The one body-parse defect the writer can identify: it comes from the charset decoder rather than the parser's own prose.")
  UnknownCharset: "UnknownCharset",

  @doc("The body parser refused the message and the defect is not attributable further. The parser's own words go to `failureMessage`, which stays on screen.")
  UnreadableBody: "UnreadableBody",
}
