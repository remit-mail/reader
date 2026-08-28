import "typespec-electrodb-emitter";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  One occurrence of a CalendarObject, flattened so a date range can be queried
  instead of expanded (issue #15). Every row is derived from
  `CalendarObject.icalData` and is replaced wholesale whenever that resource is
  written — nothing here is authoritative, and nothing writes here alone.
  
  `recurrenceId` is `\"\"` for a resource that does not recur — its one row. A
  resource that does recur has no `\"\"` row at all: every occurrence carries its
  own RECURRENCE-ID slot, the first one included, so an occurrence is
  addressable without a caller having to know whether it happened to be the
  series' first. It is part of the sort key, so it can never be absent — an
  optional value there would make the index sparse and hide the single-event
  row from the range read that has to return it.
  
  Times here are UTC instants, unlike `CalendarObject.dtStart`, which carries
  the event's own offset. The two are different jobs: `dtStart` is the value a
  client displays, and a fixed-width UTC instant is the only form in which a
  sort key orders correctly — comparing offset-bearing strings would sort
  `09:00+02:00` after `09:00Z`, and a range read would silently drop
  occurrences from every zone but its own.
  """)
@entity("calendarEventIndex", "remit")
@index(
  "CalendarEventIndex",
  {
    pk: [CalendarEventIndex.calendarId],
    sk: [CalendarEventIndex.calendarObjectId, CalendarEventIndex.recurrenceId],
  }
)
// Every occurrence in a date range, in start order — the calendar-view read.
@index(
  "byStart",
  {
    index: "gsi0",
    pk: [CalendarEventIndex.calendarId],
    sk: [CalendarEventIndex.startAt],
  }
)
model CalendarEventIndex {
  @doc("Collection this occurrence belongs to")
  @visibility(Lifecycle.Read)
  calendarId: UUID;

  @doc("Resource this occurrence was expanded from")
  @visibility(Lifecycle.Read)
  calendarObjectId: UUID;

  @doc("RECURRENCE-ID of this occurrence as an ISO 8601 UTC instant, or `\"\"` for the one row of a resource that does not recur. Canonicalized to UTC by the same rule the expansion uses, so an override's RECURRENCE-ID and the occurrence it replaces resolve to the same value.")
  @visibility(Lifecycle.Read)
  recurrenceId: String64;

  @doc("When this occurrence starts, as an ISO 8601 UTC instant. An all-day occurrence starts at midnight of its civil date read in the collection's timezone.")
  @visibility(Lifecycle.Read)
  startAt: String64;

  @doc("When this occurrence ends, as an ISO 8601 UTC instant. Exclusive for an all-day occurrence, per RFC 5545 3.6.1.")
  @visibility(Lifecycle.Read)
  endAt: String64;

  @doc("Whether this occurrence is all-day, copied from the resource it came from so a range read never has to join back to it. A client renders an all-day occurrence as the civil date its start falls on in the collection's timezone, not as the instant stored here.")
  @visibility(Lifecycle.Read)
  allDay: boolean = false;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
