namespace RemitImap;

@doc("Where the reader stands on one occurrence, projected from its ORGANIZER and ATTENDEE lines against the addresses of the reader's own accounts.")
enum CalendarParticipation {
  @doc("The occurrence carries no ATTENDEE lines, or none of them is the reader. Nothing to answer.")
  Unscheduled: "Unscheduled",

  @doc("The reader organizes this occurrence and has invited guests.")
  Organizer: "Organizer",

  @doc("The reader is a guest who has not answered. `PARTSTAT=NEEDS-ACTION`, or no PARTSTAT.")
  NeedsAction: "NeedsAction",

  @doc("The reader is a guest who said yes. `PARTSTAT=ACCEPTED`.")
  Accepted: "Accepted",

  @doc("The reader is a guest who said maybe. `PARTSTAT=TENTATIVE`.")
  Tentative: "Tentative",

  @doc("The reader is a guest who said no. `PARTSTAT=DECLINED`. The occurrence stays on the calendar.")
  Declined: "Declined",
}
