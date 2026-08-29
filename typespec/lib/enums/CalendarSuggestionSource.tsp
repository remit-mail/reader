namespace RemitImap;

@doc("Where in a message a suggestion was read from. It is what a card says to explain itself, and it is what separates a suggestion carrying real iCalendar from one inferred out of prose.")
enum CalendarSuggestionSource {
  @doc("A `text/calendar` part sent inline, which is how a scheduling message carries its invitation.")
  IcalendarPart: "IcalendarPart",

  @doc("A `text/calendar` part sent as an attachment — the same bytes, filed as a file, which is what a client that cannot do iTIP sends.")
  IcalendarAttachment: "IcalendarAttachment",

  @doc("A time read out of the message's prose, with no iCalendar anywhere. Such a suggestion carries no `icalData` and is a guess about what the sender meant.")
  TextHeuristic: "TextHeuristic",
}
