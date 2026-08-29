namespace RemitImap;

@doc("What has become of a suggestion. `Pending` is the only state that asks a person for anything; every other value is a decision already taken, and nothing but an explicit act moves a suggestion out of `Pending`.")
enum CalendarSuggestionState {
  @doc("Waiting on the user. The card is offered beside the message.")
  Pending: "Pending",

  @doc("The user added it to a calendar. `acceptedCalendarObjectId` names the resource that was written.")
  Accepted: "Accepted",

  @doc("The user said no. No calendar object was written, and no reply was sent to the organizer.")
  Declined: "Declined",

  @doc("The user has not committed. Kept distinct from `Pending` so a card that was answered tentatively is not offered again as unanswered.")
  Tentative: "Tentative",

  @doc("The user waved the card away. Nothing was written, and dismissing with `muteSender` also writes a sender rule so this sender's invitations stop being offered.")
  Dismissed: "Dismissed",

  @doc("A later message carried the same UID with a higher SEQUENCE, so this revision is stale. Set by the producer, never by a person, and never on a suggestion the user already answered.")
  Superseded: "Superseded",
}
