namespace RemitImap;

@doc("Authentication verdict for a single auth mechanism, as reported in the Authentication-Results header.")
enum AuthResultVerdict {
  Pass: "Pass",
  Fail: "Fail",
  None: "None",
  Neutral: "Neutral",
  Softfail: "Softfail",
}
