import "@typespec/http";

import "../enums/CalendarColor.tsp";
import "../enums/CalendarEventStatus.tsp";
import "../enums/CalendarTransparency.tsp";
import "../enums/ZoneCertainty.tsp";
import "../scalars/string.tsp";
import "./CalendarCollection.tsp";
import "./CalendarObject.tsp";

using TypeSpec.Http;

namespace RemitImap;

// ============================================
// Collections
// ============================================

@doc("""
  Input for creating a calendar collection (issue #15).
  
  `urlSegment` is supplied rather than derived from the display name: it is the
  collection's identity — `calendarId` is a hash of it — and the path a CalDAV
  client will later bookmark. Slugging a name would make two calendars called
  "Work" one row, and a rename would either move a bookmarked path or leave a
  segment that no longer matches anything a person recognises. The name is the
  mutable overlay; this is the address.
  """)
model CreateCalendarInput {
  ...OmitProperties<Create<CalendarCollection>, "color" | "timezone">;

  @doc("Path segment addressing this collection, unique within the account config. Case-folded on write, so \"Work\" and \"work\" name the same collection and the second create is refused rather than silently merged into the first.")
  urlSegment: String64;

  @doc("Display colour slot. Absent takes the collection's own default.")
  color?: CalendarColor;

  @doc("IANA time zone this collection's floating times are read in. Absent reads them as UTC.")
  timezone?: String64;
}

@doc("Input for updating a calendar collection. The name, colour and timezone are the mutable overlay; `urlSegment` is not among them, because it is the collection's identity and the path a client has bookmarked.")
model UpdateCalendarInput is Update<CalendarCollection>;

@doc("A calendar collection as the API returns it.")
model CalendarResponse {
  ...CalendarCollection;
}

@doc("Every calendar collection of the caller's account config, url segment first. Unpaginated: an account holds a handful of calendars, and a page boundary in a sidebar is a bug waiting to happen.")
model CalendarListResponse {
  items: CalendarResponse[];
}

// ============================================
// Events
// ============================================

@doc("""
  One occurrence of an event, in the window the caller asked for (issue #15).
  
  Instances are expanded by the server. A client never reads an RRULE and never
  reconstructs a series: it renders what this returns, and addresses one
  occurrence by `calendarObjectId` plus `recurrenceId`.
  """)
model CalendarEventInstance {
  @doc("Collection this occurrence belongs to")
  calendarId: UUID;

  @doc("Resource this occurrence was expanded from")
  calendarObjectId: UUID;

  @doc("RECURRENCE-ID of this occurrence as an ISO 8601 UTC instant, or `\"\"` for a resource that does not recur. This is the value a scoped write passes back to name the occurrence it means.")
  recurrenceId: String64;

  @doc("The event's iCalendar UID, shared by every occurrence of the series")
  icalUid: String512;

  @doc("Projection of the VEVENT's SUMMARY. `\"\"` when the event carries none.")
  summary: String512;

  @doc("When this occurrence starts, as an ISO 8601 date-time with zone offset, read in the collection's timezone. A business date, not an epoch instant: an all-day occurrence carries midnight of its civil date.")
  start: String64;

  @doc("When this occurrence ends, as an ISO 8601 date-time with zone offset. Exclusive for an all-day occurrence, per RFC 5545 3.6.1.")
  end: String64;

  @doc("Whether this occurrence is all-day")
  allDay: boolean;

  @doc("Projection of the occurrence's STATUS")
  status: CalendarEventStatus;

  @doc("Projection of the occurrence's TRANSP — whether it consumes free/busy time")
  transparency: CalendarTransparency;

  @doc("How the resource's start was placed on the clock. `Ambiguous` means the resource named a zone nothing could resolve, so this occurrence may be hours out; a client says so rather than presenting the guess as a fact.")
  zoneCertainty: ZoneCertainty;

  @doc("Entity tag of the resource this occurrence came from. Pass it as `If-Match` on a scoped write to refuse an edit built on a version somebody has since replaced.")
  etag: String64;

  @doc("Whether the resource this occurrence came from expands to more than one instance. A client showing the recurrence-scope prompt gates on this.")
  hasRecurrence: boolean;
}

@doc("""
  Expanded occurrences in the requested window, in start order.
  
  Includes an occurrence that began before `from` and runs into the window, up
  to a bounded lookback — a meeting that started last night is part of this
  morning. Unpaginated: the window is the bound.
  """)
model CalendarEventListResponse {
  items: CalendarEventInstance[];
}

@doc("A stored calendar resource — the bytes behind one event, plus the columns projected from them. `icalData` is canonical; every other field is derived from it on write.")
model CalendarEventResponse {
  ...CalendarObject;
}

@doc("""
  Input for creating an event (issue #15). The server builds the VEVENT and
  writes it through the single calendar write path, so an event created here,
  one accepted from an invitation, and one PUT over CalDAV are the same bytes
  written the same way.
  
  Times are ISO 8601 with zone offset — or a bare `YYYY-MM-DD` date when
  `allDay` is set. The offset pins the instant; `timeZone` names the zone the
  event is anchored in, which is what a recurring event needs to survive a DST
  transition. An offset alone cannot: a weekly 09:00 meeting written as
  `+02:00` becomes an 08:00 meeting in November.
  """)
model CreateCalendarEventInput {
  @doc("Collection to write the event into")
  calendarId: UUID;

  @doc("SUMMARY of the event")
  summary: String512;

  @doc("DESCRIPTION of the event. Absent writes none.")
  description?: String2048;

  @doc("LOCATION of the event. Absent writes none.")
  location?: String512;

  @doc("When the event starts: an ISO 8601 date-time with zone offset, or a `YYYY-MM-DD` date when `allDay` is set.")
  start: String64;

  @doc("When the event ends, in the same form as `start`. Exclusive for an all-day event, per RFC 5545 3.6.1.")
  end: String64;

  @doc("Whether this is an all-day event, whose times are civil dates rather than instants")
  allDay?: boolean;

  @doc("IANA time zone the event is anchored in, e.g. \"Europe/Amsterdam\", written as the DTSTART TZID. Absent anchors the event in UTC. Refused with 400 when the zone is one this server cannot resolve — a calendar that accepted an unknown zone would draw the event hours away from where it belongs.")
  timeZone?: String64;

  @doc("STATUS of the event")
  status?: CalendarEventStatus;

  @doc("TRANSP of the event — whether it consumes free/busy time")
  transparency?: CalendarTransparency;

  @doc("RRULE value for a recurring event, e.g. \"FREQ=WEEKLY;BYDAY=MO\" (RFC 5545 3.8.5.3), without the property name. `\"\"` creates a single event. Refused with 400 when it is not a rule this server can read.")
  recurrenceRule?: String512;
}

@doc("""
  Input for updating an event. Every field is optional and absence means
  untouched — a patch that carries only `summary` renames the event and moves
  nothing.
  
  What the patch applies to is the `scope` parameter's business: `All` rewrites
  the master, `This` writes a RECURRENCE-ID override for one occurrence, and
  `Following` splits the series at one occurrence and applies the patch to the
  remainder.
  """)
model UpdateCalendarEventInput {
  summary?: String512;
  description?: String2048;
  location?: String512;
  start?: String64;
  end?: String64;
  allDay?: boolean;
  timeZone?: String64;
  status?: CalendarEventStatus;
  transparency?: CalendarTransparency;

  @doc("RRULE value, or `\"\"` to drop the rule. Only meaningful with `scope=All` or `scope=Following`: an override is one occurrence and carries no rule of its own.")
  recurrenceRule?: String512;
}

@doc("Nothing to return. The resource, or the occurrence, is gone.")
model CalendarNoContent {
  @statusCode statusCode: 204;
}

// ============================================
// Free/busy
// ============================================

@doc("""
  One stretch of time the caller is busy in. Merged across every calendar they
  hold, so two overlapping meetings in two calendars are one span and a caller
  asking \"is this slot free\" never has to do the merging itself.
  """)
model CalendarFreeBusySpan {
  @doc("When the busy stretch starts, as an ISO 8601 date-time with a `+00:00` offset. A busy span is an interval on the clock rather than a civil date, so it carries no calendar's local zone — the caller renders it in whichever zone it is drawing.")
  start: String64;

  @doc("When the busy stretch ends, as an ISO 8601 date-time with a `+00:00` offset")
  end: String64;
}

@doc("Merged busy spans over the requested window, in start order. An event marked TRANSP:TRANSPARENT or STATUS:CANCELLED is not busy time and never appears here.")
model CalendarFreeBusyResponse {
  items: CalendarFreeBusySpan[];
}

// ============================================
// Feeds (issue #1067)
// ============================================

@doc("""
  A calendar's secret subscription address, with the token in the clear.
  
  Returned by the write that mints it and nowhere else. Only the hash is
  stored, so a client that loses this value rotates the feed rather than
  reading it back — which is also what makes the read side safe to leave
  tokenless.
  """)
model CalendarFeedResponse {
  @doc("Collection this address serves")
  calendarId: UUID;

  @doc("The token itself, base64url over 32 random bytes. It is the whole credential: the path `/feeds/calendar/{feedToken}.ics` needs nothing else, which is what lets a client that cannot sign in subscribe.")
  feedToken: String512;

  @doc("When this calendar first got a feed address")
  createdAt: int64;

  @doc("When the token was last replaced. `0` means it is still the first one.")
  rotatedAt: int64;
}

@doc("Whether a calendar has a feed address, and how old it is. The token is deliberately absent — it exists in the clear once, in the answer to the write that minted it.")
model CalendarFeedStateResponse {
  @doc("Collection this address serves")
  calendarId: UUID;

  @doc("When this calendar first got a feed address")
  createdAt: int64;

  @doc("When the token was last replaced. `0` means it is still the first one.")
  rotatedAt: int64;
}

@doc("""
  A whole calendar as iCalendar text, for a client that subscribed to the
  secret address.
  
  Recurring events are the stored masters with their RRULE, not an expansion:
  a subscriber renders its own occurrences and expects to keep doing so
  indefinitely, and an expansion would silently end at whatever horizon this
  server chose.
  
  The calendar's name travels as the `X-WR-CALNAME` property inside the
  VCALENDAR, which is where Apple Calendar, Google Calendar and Thunderbird
  read it from.
  """)
model CalendarFeedIcalResponse {
  @header contentType: "text/calendar; charset=utf-8";

  @doc("Strong entity tag over the bytes being served. A subscriber polls often and sends it back as `If-None-Match`.")
  @header("ETag")
  etag: string;

  @doc("HTTP-date the collection was last written, which is stamped by every event write and every event delete. The collection's own timestamp rather than its newest event: deleting the newest event leaves every survivor older than the change, and a validator that moved backwards would tell a subscriber its stale copy is current.")
  @header("Last-Modified")
  lastModified: string;

  @body icalData: string;
}

@doc("The subscriber already holds these bytes. Answered when `If-None-Match` carries the tag the feed would serve, or when `If-Modified-Since` is not older than the calendar's last change.")
model CalendarFeedNotModified {
  @statusCode statusCode: 304;

  @header("ETag")
  etag: string;

  @doc("The same validator a 200 would have carried, so a subscriber that polls by date can keep doing so")
  @header("Last-Modified")
  lastModified: string;
}

@doc("No feed answers to this address. Unknown, revoked and malformed tokens are one answer with one body, so a caller learns nothing about which of the three it sent.")
model CalendarFeedNotFound {
  @statusCode statusCode: 404;
  @header contentType: "text/plain; charset=utf-8";
  @body message: string;
}
