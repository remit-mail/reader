namespace RemitImap;

@doc("The answer an invitation is added to a calendar with. It is written as the user's `ATTENDEE;PARTSTAT` on the stored event (RFC 5545 3.2.12) and becomes the suggestion's state.")
enum CalendarInviteAnswer {
  @doc("Coming. Writes `PARTSTAT=ACCEPTED`; the suggestion becomes `Accepted`.")
  Accepted: "Accepted",

  @doc("Maybe. Writes `PARTSTAT=TENTATIVE`; the suggestion becomes `Tentative`.")
  Tentative: "Tentative",
}
