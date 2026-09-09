namespace RemitImap;

@doc("The iTIP method a scheduling message carries (RFC 5546 3.2), read from the VCALENDAR's METHOD property. It says what the sender is asking for, which is not derivable from the VEVENT: a cancellation and an invitation differ by this property alone.")
enum CalendarInviteMethod {
  @doc("An invitation, or a revision of one.")
  Request: "Request",

  @doc("An attendee answering someone else's invitation. Nothing is offered to accept; the event is the organizer's.")
  Reply: "Reply",

  @doc("The organizer withdrawing the event.")
  Cancel: "Cancel",

  @doc("An attendee proposing a different time.")
  Counter: "Counter",

  @doc("An event published for information, addressed to nobody in particular.")
  Publish: "Publish",

  @doc("The resource declared no METHOD — a bare `.ics` rather than a scheduling message.")
  None: "None",
}
