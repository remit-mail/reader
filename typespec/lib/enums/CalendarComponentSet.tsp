namespace RemitImap;

@doc("Which iCalendar components a collection accepts (RFC 4791 supported-calendar-component-set). Only VEVENT is stored today; VTODO and VJOURNAL collections would be separate members, so the value is a property of the collection rather than of each object.")
enum CalendarComponentSet {
  VeventOnly: "VeventOnly",
}
