import "typespec-electrodb-emitter";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  One task — the bytes of one VTODO resource in a `VtodoOnly` collection, plus
  the columns projected from them.
  
  A distinct entity from `CalendarObject`, not an object with a kind: a task has
  a due date and a done state where an event has a span and a recurrence, and
  every reader of either would otherwise narrow on the kind first.
  
  `icalData` is canonical; every other column is projected from it on write.
  `calendarTaskId` is derived from `(calendarId, resourceName)`, the same rule
  `CalendarObject` keys by.
  """)
@entity("calendarTask", "remit")
@index(
  "CalendarTask",
  {
    pk: [CalendarTask.calendarId],
    sk: [CalendarTask.calendarTaskId],
  }
)
// A collection's tasks in due order — the window read the calendar draws from.
@index(
  "byDue",
  {
    index: "gsi0",
    pk: [CalendarTask.calendarId],
    sk: [CalendarTask.dueAt],
  }
)
model CalendarTask {
  @doc("Primary identifier, derived from calendarId + resourceName")
  @visibility(Lifecycle.Read)
  calendarTaskId: UUID;

  @doc("Collection this task belongs to, a `VtodoOnly` one")
  @visibility(Lifecycle.Read)
  calendarId: UUID;

  @doc("Last path segment of the resource's URL, e.g. \"a1b2c3.ics\"")
  @visibility(Lifecycle.Read)
  resourceName: String256;

  @doc("The VTODO's UID property")
  @visibility(Lifecycle.Read)
  icalUid: String512;

  @doc("The complete VCALENDAR text — CANONICAL")
  @visibility(Lifecycle.Read)
  icalData: string;

  @doc("Strong entity tag over the stored `icalData` bytes, for If-Match")
  @visibility(Lifecycle.Read)
  etag: String64;

  @doc("Projection of the VTODO's SUMMARY. `\"\"` when it carries none.")
  @visibility(Lifecycle.Read)
  summary: String512;

  @doc("Projection of the VTODO's DESCRIPTION. `\"\"` when it carries none.")
  @visibility(Lifecycle.Read)
  description: String2048;

  @doc("Projection of the VTODO's DUE as an ISO 8601 date-time with zone offset, read in the collection's timezone — a business date. An all-day task carries midnight of its civil date.")
  @visibility(Lifecycle.Read)
  due: String64;

  @doc("The same moment as `due`, as an ISO 8601 UTC instant, so `byDue` orders across zones.")
  @visibility(Lifecycle.Read)
  dueAt: String64;

  @doc("Whether DUE is a DATE rather than a DATE-TIME: the task is due on a day, not at a time")
  @visibility(Lifecycle.Read)
  allDay: boolean = false;

  @doc("Whether the VTODO is done: `STATUS:COMPLETED`")
  @visibility(Lifecycle.Read)
  completed: boolean = false;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
