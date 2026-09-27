namespace RemitImap;

@doc("Whether an answered cancellation holds the calendar object this suggestion's answer wrote. A cancellation is terminal, so such an answer cannot be taken back.")
enum CalendarAnswerOvertaken {
  @doc("No answered cancellation holds the event, or this suggestion wrote none.")
  None: "None",

  @doc("A cancellation of the event is answered into the same event.")
  Cancellation: "Cancellation",
}
