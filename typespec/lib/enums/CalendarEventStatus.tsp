namespace RemitImap;

@doc("Projection of a VEVENT's STATUS property (RFC 5545 3.8.1.11). A VEVENT with no STATUS projects as `Confirmed`, which is the value RFC 5545 gives an event whose status is unstated.")
enum CalendarEventStatus {
  Confirmed: "Confirmed",
  Tentative: "Tentative",
  Cancelled: "Cancelled",
}
