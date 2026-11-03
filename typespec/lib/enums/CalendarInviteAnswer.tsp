namespace RemitImap;

@doc("The answer a guest gives an invitation. It is written as the reader's `ATTENDEE;PARTSTAT` on the stored event (RFC 5545 3.2.12).")
enum CalendarInviteAnswer {
  @doc("Coming. Writes `PARTSTAT=ACCEPTED`; a suggestion becomes `Accepted`.")
  Accepted: "Accepted",

  @doc("Maybe. Writes `PARTSTAT=TENTATIVE`; a suggestion becomes `Tentative`.")
  Tentative: "Tentative",

  @doc("Not coming. Writes `PARTSTAT=DECLINED`; a suggestion becomes `Declined`. Taken by an answer on a stored event only: a suggestion is declined through its own `decline` operation.")
  Declined: "Declined",
}
