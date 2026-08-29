namespace RemitImap;

@doc("Projection of a VEVENT's TRANSP property (RFC 5545 3.8.2.7) — whether the event consumes free/busy time. A VEVENT with no TRANSP projects as `Opaque`, the RFC default.")
enum CalendarTransparency {
  Opaque: "Opaque",
  Transparent: "Transparent",
}
