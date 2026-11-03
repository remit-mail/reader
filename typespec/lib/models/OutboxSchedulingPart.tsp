import "typespec-electrodb-emitter";

import "../enums/CalendarInviteMethod.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  The iCalendar scheduling part of one outbox message: an invitation, a
  cancellation or a reply about a calendar event (RFC 6047). The message is
  built with it as its `text/calendar; method=…` part, on the wire and in the
  Sent copy alike.
  
  A row of its own rather than columns on `OutboxMessage`: most messages carry
  none, and a column a mail never fills is a column every mail reads as absent.
  It lives and dies with its outbox row, which is what lets an event list the
  scheduling messages it still has in flight.
  """)
@entity("outboxSchedulingPart", "remit")
@index(
  "OutboxSchedulingPart",
  {
    pk: [OutboxSchedulingPart.outboxMessageId],
    sk: [],
  }
)
// The messages one event still has in the outbox — what `sends` lists on a read.
@index(
  "byCalendarObject",
  {
    index: "gsi0",
    pk: [OutboxSchedulingPart.accountConfigId],
    sk: [OutboxSchedulingPart.calendarObjectId],
  }
)
model OutboxSchedulingPart {
  @doc("The outbox message this part belongs to")
  @visibility(Lifecycle.Read)
  outboxMessageId: UUID;

  @doc("Owning account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("The calendar resource the message is about")
  @visibility(Lifecycle.Read)
  calendarObjectId: UUID;

  @doc("The one address the message is to, lower-cased")
  @visibility(Lifecycle.Read)
  recipient: String512;

  @doc("The iTIP method the part carries (RFC 5546 3.2)")
  @visibility(Lifecycle.Read)
  method: CalendarInviteMethod;

  @doc("SEQUENCE of the event the part was built from. A recipient keeps the highest it has seen, so a later message overtakes an earlier one still in flight.")
  @visibility(Lifecycle.Read)
  sequence: int32;

  @doc("The VCALENDAR text, with its METHOD property, exactly as it is sent")
  @visibility(Lifecycle.Read)
  icalData: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
