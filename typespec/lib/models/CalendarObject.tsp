import "typespec-electrodb-emitter";

import "../enums/CalendarEventStatus.tsp";
import "../enums/CalendarTransparency.tsp";
import "../enums/ZoneCertainty.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  One calendar resource — the bytes behind one `.ics` URL (issue #15).
  
  `icalData` is the canonical value. Every other column on this row is a
  projection of it, computed on write and never written independently: a reader
  that needs a fact the projection does not carry re-parses `icalData` rather
  than adding a column that could disagree with it.
  
  The write path parses the bytes to validate and project them and then stores
  the bytes it was handed, never a reserialization of them. That is what keeps
  `etag` honest: the tag is a digest of exactly what the writer sent, so it
  moves only when a writer sends something different. It is not a digest that
  survives a round trip through the parser — ical.js refolds long lines and
  reorders properties, so a resource stored as its own reserialization would
  change tag without anyone editing it, and every client's cache would miss.
  
  `calendarObjectId` is derived from `(calendarId, resourceName)`: the resource
  name is the last path segment of the resource's URL, so the URL a client holds
  resolves to a row directly, and a repeated PUT of the same resource rewrites
  its own row.
  """)
@entity("calendarObject", "remit")
@index(
  "CalendarObject",
  {
    pk: [CalendarObject.calendarId],
    sk: [CalendarObject.calendarObjectId],
  }
)
// The resource carrying a given iCalendar UID. Distinct from `resourceName`:
// a client may name the file anything, and REPORTs address events by UID.
@index(
  "byUid",
  {
    index: "gsi0",
    pk: [CalendarObject.calendarId],
    sk: [CalendarObject.icalUid],
  }
)
// Everything changed since a sync token, in change order — the WebDAV-Sync read.
@index(
  "bySyncSequence",
  {
    index: "gsi1",
    pk: [CalendarObject.calendarId],
    sk: [CalendarObject.syncSequence],
  }
)
model CalendarObject {
  @doc("Primary identifier, derived from calendarId + resourceName")
  @visibility(Lifecycle.Read)
  calendarObjectId: UUID;

  @doc("Collection this resource belongs to")
  @visibility(Lifecycle.Read)
  calendarId: UUID;

  @doc("Last path segment of the resource's URL, e.g. \"a1b2c3.ics\". Unique within the collection and chosen by whoever wrote the resource, never derived from its contents — a client is free to rename a resource without changing the event it holds.")
  @visibility(Lifecycle.Read)
  resourceName: String256;

  @doc("The VEVENT's UID property (RFC 5545 3.8.4.7). Identifies the event across collections and servers, which `resourceName` does not.")
  @visibility(Lifecycle.Read)
  icalUid: String512;

  @doc("The complete VCALENDAR text, byte-for-byte as stored — CANONICAL. Line endings are CRLF and are never normalized; unknown properties and components are preserved verbatim.")
  @visibility(Lifecycle.Read)
  icalData: string;

  @doc("Strong entity tag over the stored `icalData` bytes, used for If-Match on a conditional write and for change detection on read.")
  @visibility(Lifecycle.Read)
  etag: String64;

  @doc("The VEVENT's SEQUENCE property (RFC 5545 3.8.7.4) — the organizer's own revision counter, carried for scheduling comparisons. `0` when the event declares none, which is the RFC default.")
  @visibility(Lifecycle.Read)
  sequence: int32 = 0;

  @doc("Value the owning collection's `syncSequence` held after the write that produced this row. Pages the `bySyncSequence` read.")
  @visibility(Lifecycle.Read)
  syncSequence: int64 = 0;

  @doc("Projection of the VEVENT's SUMMARY (RFC 5545 3.8.1.12). `\"\"` when the event carries none.")
  @visibility(Lifecycle.Read)
  summary: String512;

  @doc("Projection of the master VEVENT's DTSTART as an ISO 8601 date-time with zone offset — a business date, not an epoch instant. An all-day event carries midnight in the event's own zone.")
  @visibility(Lifecycle.Read)
  dtStart: String64;

  @doc("Projection of the master VEVENT's effective end as an ISO 8601 date-time with zone offset, resolved from DTEND or from DTSTART + DURATION. An event with neither ends when it starts (RFC 5545 3.6.1).")
  @visibility(Lifecycle.Read)
  dtEnd: String64;

  @doc("Whether the master VEVENT's DTSTART is a DATE rather than a DATE-TIME (RFC 5545 3.3.4) — an all-day or multi-day event, whose end is exclusive.")
  @visibility(Lifecycle.Read)
  allDay: boolean = false;

  @doc("How the master VEVENT's DTSTART was placed on the clock. `Ambiguous` means the resource named a zone nothing could resolve, so `dtStart` and every occurrence expanded from it may be off by hours — a client shows the event and says so rather than presenting a guess as a fact.")
  @visibility(Lifecycle.Read)
  zoneCertainty: ZoneCertainty = ZoneCertainty.Explicit;

  @doc("Projection of the master VEVENT's STATUS")
  @visibility(Lifecycle.Read)
  status: CalendarEventStatus = CalendarEventStatus.Confirmed;

  @doc("Projection of the master VEVENT's TRANSP")
  @visibility(Lifecycle.Read)
  transparency: CalendarTransparency = CalendarTransparency.Opaque;

  @doc("Whether the resource expands to more than its master instance — an RRULE, an RDATE, or an override VEVENT. Overrides count on their own: a client that edits one instance and then drops the rule leaves a resource with a master and its exceptions, and each of those is still an occurrence.")
  @visibility(Lifecycle.Read)
  hasRecurrence: boolean = false;

  @doc("ISO 8601 UTC instant through which `CalendarEventIndex` rows exist for this resource, when the series runs past the expansion horizon and the index is therefore incomplete. `\"\"` when the index is exhaustive — a single event, or a series that ends inside the horizon. A later live-expansion pass reads this to find the resources whose instances it must compute rather than query.")
  @visibility(Lifecycle.Read)
  expandedThrough: String64 = "";

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
