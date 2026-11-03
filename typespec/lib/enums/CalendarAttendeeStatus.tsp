namespace RemitImap;

@doc("A guest's answer to an event, read from the ATTENDEE line's PARTSTAT (RFC 5545 3.2.12).")
enum CalendarAttendeeStatus {
  @doc("No answer yet. `PARTSTAT=NEEDS-ACTION`, or no PARTSTAT.")
  NeedsAction: "NeedsAction",

  @doc("`PARTSTAT=ACCEPTED`")
  Accepted: "Accepted",

  @doc("`PARTSTAT=TENTATIVE`")
  Tentative: "Tentative",

  @doc("`PARTSTAT=DECLINED`")
  Declined: "Declined",
}
