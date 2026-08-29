namespace RemitImap;

@doc("Which occurrences of a recurring event a write applies to (issue #15). A request parameter, never a stored column: the resource records what the series is, and this records what the caller meant by editing one drawing of it.")
enum RecurrenceScope {
  @doc("This occurrence alone. An edit becomes a RECURRENCE-ID override inside the same resource; a delete becomes an EXDATE on the master. The rest of the series is untouched.")
  This: "This",

  @doc("This occurrence and every later one. The master's rule is truncated to end just before it, and a second resource carries the remainder with a UID of its own — the split every calendar client offers, and the only way iCalendar can express \"from here on\".")
  Following: "Following",

  @doc("The whole series, which for a single event is the event. An edit rewrites the master; a delete removes the resource and every occurrence it produced.")
  All: "All",
}
