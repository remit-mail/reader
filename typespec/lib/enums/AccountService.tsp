namespace RemitImap;

@doc("A service an account syncs. `Mail` covers messages, folders and sending; `Calendar` covers a provider calendar read into the calendar store.")
enum AccountService {
  Mail: "Mail",
  Calendar: "Calendar",
}
