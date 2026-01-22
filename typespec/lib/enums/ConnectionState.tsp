@doc("IMAP connection states per RFC 9051 Section 3")
enum ConnectionState {
  @doc("Connection established but not authenticated")
  NotAuthenticated: "not_authenticated",

  @doc("Successfully authenticated")
  Authenticated: "authenticated",

  @doc("Mailbox selected for operations")
  Selected: "selected",

  @doc("Connection being terminated")
  Logout: "logout",
}
