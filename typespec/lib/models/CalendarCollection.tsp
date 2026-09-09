import "typespec-electrodb-emitter";

import "../enums/CalendarColor.tsp";
import "../enums/CalendarComponentSet.tsp";
import "../enums/CalendarSource.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  A calendar collection scoped to an account config (issue #15) — the CalDAV
  collection a client mounts, and the parent of every CalendarObject.
  
  `calendarId` is derived from `(accountConfigId, urlSegment)`, so the DAV path
  a client bookmarks resolves to a row without a lookup table, and provisioning
  the same collection twice writes the same row instead of a second one.
  `displayName` is the mutable human overlay and is never the key.
  
  `syncSequence` is the collection's monotonic change counter: every write
  through the calendar service's put path bumps it and stamps the new value on
  the object it wrote, which is what a later WebDAV-Sync `sync-token` reports
  and what `CalendarObject.bySyncSequence` pages by.
  """)
@entity("calendar", "remit")
@index(
  "Calendar",
  {
    pk: [CalendarCollection.accountConfigId],
    sk: [CalendarCollection.calendarId],
  }
)
@index(
  "byUrlSegment",
  {
    index: "gsi0",
    pk: [CalendarCollection.accountConfigId],
    sk: [CalendarCollection.urlSegment],
  }
)
model CalendarCollection {
  @doc("Primary identifier, derived from accountConfigId + urlSegment")
  @visibility(Lifecycle.Read)
  calendarId: UUID;

  @doc("Owning account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Path segment this collection is addressed by, unique within the account config. Stored case-folded, the same folding `calendarId` is derived from — a DAV path is matched case-insensitively, and storing the writer's casing would let a lookup by segment and a lookup by derived id disagree about one path. The default collection provisioned on first use holds \"default\".")
  @visibility(Lifecycle.Read)
  urlSegment: String64;

  @doc("Human-readable collection name (display)")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  displayName: String140;

  @doc("Display color slot for this collection")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  color: CalendarColor = CalendarColor.Cal1;

  @doc("Which iCalendar components this collection accepts")
  @visibility(Lifecycle.Read)
  componentSet: CalendarComponentSet = CalendarComponentSet.VeventOnly;

  @doc("Where this collection came from")
  @visibility(Lifecycle.Read)
  source: CalendarSource = CalendarSource.UserCreated;

  @doc("IANA time zone this collection's floating times are read in, e.g. \"Europe/Amsterdam\". `\"\"` when none is set, which reads as UTC.")
  @visibility(Lifecycle.Create, Lifecycle.Read, Lifecycle.Update)
  timezone: String64 = "";

  @doc("Monotonic change counter for this collection. Bumped by every write to one of its objects; the value stamped on `CalendarObject.syncSequence` is the value this counter held after that write.")
  @visibility(Lifecycle.Read)
  syncSequence: int64 = 0;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
