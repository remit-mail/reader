namespace RemitImap;

@doc("What one person on an event's guest list is to it.")
enum CalendarAttendeeRole {
  @doc("The event's ORGANIZER.")
  Organizer: "Organizer",

  @doc("An ATTENDEE invited by the organizer.")
  Guest: "Guest",
}
