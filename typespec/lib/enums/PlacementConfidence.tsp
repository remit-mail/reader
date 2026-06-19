namespace RemitImap;

@doc("Confidence of a placement verdict. `Confident` verdicts move mail (when the dark-ship flag is on); `Unsure` verdicts are recorded but never moved.")
enum PlacementConfidence {
  Confident: "Confident",
  Unsure: "Unsure",
}
