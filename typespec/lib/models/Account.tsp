import "../enums/ConnectionState.tsp";

@doc("Represents an IMAP user account. Contains authentication credentials and account metadata.")
model Account {
  @doc("Primary identifier")
  accountId: string;

  @doc("Login username")
  @minLength(1)
  username: string;

  @doc("Primary email address")
  email: string;

  @doc("Hashed password for authentication")
  @secret
  passwordHash: string;

  @doc("Account creation timestamp")
  createdAt: utcDateTime;

  @doc("Last modification timestamp")
  updatedAt: utcDateTime;

  @doc("Whether the account is active and can login")
  isActive: boolean;
}

@doc("Tracks active IMAP connections and their state per RFC 9051 Section 3")
model Session {
  @doc("Primary identifier")
  sessionId: string;

  @doc("Reference to the authenticated account")
  accountId: string;

  @doc("Current connection state")
  connectionState: ConnectionState;

  @doc("Currently selected mailbox (if in selected state)")
  selectedMailbox?: string;

  @doc("Session creation timestamp")
  createdAt: utcDateTime;

  @doc("Last activity timestamp")
  lastActivity: utcDateTime;

  @doc("Client identification string (from ID command)")
  clientInfo?: string;
}
