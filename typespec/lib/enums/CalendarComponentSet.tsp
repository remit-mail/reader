namespace RemitImap;

@doc("Which iCalendar components a collection accepts (RFC 4791 supported-calendar-component-set). The value is a property of the collection rather than of each object, so an event collection and a task collection are separate collections.")
enum CalendarComponentSet {
  @doc("Events. The collection holds `CalendarObject` resources.")
  VeventOnly: "VeventOnly",

  @doc("Tasks. The collection holds `CalendarTask` resources and refuses event writes.")
  VtodoOnly: "VtodoOnly",
}
