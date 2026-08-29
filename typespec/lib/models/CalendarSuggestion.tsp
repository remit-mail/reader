import "typespec-electrodb-emitter";

import "../enums/CalendarInviteMethod.tsp";
import "../enums/CalendarSuggestionSource.tsp";
import "../enums/CalendarSuggestionState.tsp";
import "../enums/ZoneCertainty.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  An event a message offers, waiting on a person (issue #1033).
  
  A suggestion is not a calendar entry and never becomes one on its own. It is
  derived from a message, lives beside it, and belongs to no collection: it has
  no etag, no sync sequence, and a DAV client never sees one. Nothing reaches a
  calendar until someone presses the button, which is what separates this
  entity from `CalendarObject` — the two are distinct models rather than one
  model with a kind field, because everything that makes a stored resource a
  resource is exactly what a suggestion does not have.
  
  `suggestionId` is derived from `(messageId, bodyPartId, icalUid)`, so a
  re-sync of the same message converges on the one row it wrote the first time
  instead of stacking a fresh card on the message every pass.
  
  Revisions are a chain, not an edit. A later message carrying the same
  `icalUid` with a higher `SEQUENCE` leaves the earlier suggestion in place as
  `Superseded` and writes a new `Pending` one, so the message the older card
  came from still has its card and the user can see which revision they are
  being asked about. `METHOD:CANCEL` is a suggestion of its own for the same
  reason: withdrawing an event the user accepted is a change to their calendar,
  and no message may make that change without them.
  """)
@entity("calendarSuggestion", "remit")
@index(
  "CalendarSuggestion",
  {
    pk: [CalendarSuggestion.accountConfigId],
    sk: [CalendarSuggestion.suggestionId],
  }
)
// Every suggestion a message produced — the read behind the card beside an open
// message, and behind `GET /messages/{messageId}/calendar-suggestions`.
@index(
  "byMessage",
  {
    index: "gsi0",
    pk: [CalendarSuggestion.accountConfigId],
    sk: [CalendarSuggestion.messageId, CalendarSuggestion.suggestionId],
  }
)
// The account's suggestions in one state, which is nearly always the pending
// ones. It is also how the producer finds the revision a new message
// supersedes: only a `Pending` suggestion can be superseded — an answered one
// is a decision already taken — so the set it searches is the set this index
// returns, and no separate index on `icalUid` has to exist.
@index(
  "byState",
  {
    index: "gsi1",
    pk: [CalendarSuggestion.accountConfigId],
    sk: [CalendarSuggestion.state, CalendarSuggestion.suggestionId],
  }
)
model CalendarSuggestion {
  @doc("Primary identifier, derived from messageId + bodyPartId + icalUid")
  @visibility(Lifecycle.Read)
  suggestionId: UUID;

  @doc("Owning account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Message this suggestion was read out of. The card is offered beside this message and nowhere else.")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("MIME part the iCalendar bytes came from. Part of the identity, so two invitations in one message stay two suggestions rather than overwriting each other.")
  @visibility(Lifecycle.Read)
  bodyPartId: UUID;

  @doc("The VEVENT's UID property (RFC 5545 3.8.4.7). What ties a revision, a cancellation and the original invitation together across three separate messages.")
  @visibility(Lifecycle.Read)
  icalUid: String512;

  @doc("The VEVENT's SEQUENCE property (RFC 5545 3.8.7.4) — the organizer's revision counter. A later message carrying the same `icalUid` with a higher value supersedes this one. `0` when the event declares none, which is the RFC default.")
  @visibility(Lifecycle.Read)
  sequence: int32 = 0;

  @doc("The iTIP method the VCALENDAR declared. `None` when it declared no METHOD.")
  @visibility(Lifecycle.Read)
  method: CalendarInviteMethod = CalendarInviteMethod.None;

  @doc("Where in the message this was read from")
  @visibility(Lifecycle.Read)
  source: CalendarSuggestionSource = CalendarSuggestionSource.IcalendarPart;

  @doc("What has become of this suggestion. Only `Pending` asks the user for anything.")
  @visibility(Lifecycle.Read)
  state: CalendarSuggestionState = CalendarSuggestionState.Pending;

  @doc("Projection of the VEVENT's SUMMARY. `\"\"` when the event carries none.")
  @visibility(Lifecycle.Read)
  summary: String512;

  @doc("Projection of the VEVENT's DTSTART as an ISO 8601 date-time with zone offset — a business date, not an epoch instant. An all-day event carries midnight in the event's own zone.")
  @visibility(Lifecycle.Read)
  dtStart: String64;

  @doc("Projection of the VEVENT's effective end as an ISO 8601 date-time with zone offset, resolved from DTEND or from DTSTART + DURATION. An event with neither ends when it starts (RFC 5545 3.6.1).")
  @visibility(Lifecycle.Read)
  dtEnd: String64;

  @doc("Whether DTSTART is a DATE rather than a DATE-TIME (RFC 5545 3.3.4) — an all-day or multi-day event, whose end is exclusive.")
  @visibility(Lifecycle.Read)
  allDay: boolean = false;

  @doc("Projection of the VEVENT's LOCATION. `\"\"` when the event carries none.")
  @visibility(Lifecycle.Read)
  location: String512 = "";

  @doc("Mail address of the VEVENT's ORGANIZER, without the `mailto:` scheme. `\"\"` when the event names none — which is what a `PUBLISH` typically looks like, and why dismissing with `muteSender` mutes the message's sender rather than this field.")
  @visibility(Lifecycle.Read)
  organizer: String256 = "";

  @doc("How the DTSTART above was placed on the clock. `Ambiguous` means the invitation named a zone nothing could resolve, so the time shown may be hours out — a card says so rather than presenting a guess as a fact.")
  @visibility(Lifecycle.Read)
  zoneCertainty: ZoneCertainty = ZoneCertainty.Explicit;

  @doc("The VCALENDAR text as it arrived in the message, byte for byte — CANONICAL when present. Accepting builds the stored resource out of these bytes, so an X- property nobody modelled survives into the calendar. `\"\"` for a `TextHeuristic` suggestion, which was read out of prose and has no iCalendar behind it.")
  @visibility(Lifecycle.Read)
  icalData: string = "";

  @doc("The `CalendarObject` that accepting this suggestion wrote. `\"\"` until it is accepted — the named absent state, never a missing attribute — and the resource's id afterwards, so the card can link to the event it produced.")
  @visibility(Lifecycle.Read)
  acceptedCalendarObjectId: string = "";

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

// ============================================
// API Input Models
// ============================================

@doc("Body of `POST /calendar-suggestions/{suggestionId}/accept`. Names the collection the event is written into; there is no default, because filing someone else's invitation into a calendar the user did not pick is a decision the server does not get to make.")
model AcceptCalendarSuggestionInput {
  @doc("Collection the accepted event is written into.")
  calendarId: UUID;
}

@doc("Body of `POST /calendar-suggestions/{suggestionId}/dismiss`.")
model DismissCalendarSuggestionInput {
  @doc("Also stop offering invitations from this message's sender, by writing a standing `Filter` rule. `false` dismisses this one card and nothing else.")
  muteSender: boolean = false;
}

// ============================================
// API Response Models
// ============================================

@doc("A suggestion as the API returns it. The raw `icalData` is not surfaced: a client renders the projected fields, and the bytes exist so that accepting can write them into a calendar unchanged.")
model CalendarSuggestionResponse {
  ...OmitProperties<CalendarSuggestion, "icalData">;
}
