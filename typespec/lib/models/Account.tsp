import "typespec-electrodb-emitter";

import "../enums/ConnectionState.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Configuration container for user accounts. Groups multiple IMAP accounts under a single user.")
@entity("accountConfig", "remit")
@index(
  "AccountConfig",
  {
    pk: [AccountConfig.accountConfigId],
    sk: [],
  }
)
// List all configs for a user
@index(
  "byUserId",
  {
    index: "gsi0",
    pk: [AccountConfig.userId],
    sk: [AccountConfig.accountConfigId],
  }
)
// Collection to retrieve config with all accounts and addresses
@index(
  "byAccountConfigId",
  {
    collection: "accountConfig",
    index: "gsi1",
    pk: [AccountConfig.accountConfigId],
    sk: [],
  }
)
// List all account configs (scan-like query for all records)
@index(
  "allAccountConfigs",
  {
    index: "gsi2",
    pk: [],
    sk: [AccountConfig.accountConfigId],
  }
)
model AccountConfig {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Reference to owning user (typically stored externally)")
  @visibility(Lifecycle.Read)
  userId: UUID;

  @doc("Display name for this configuration")
  @visibility(Lifecycle.Read)
  name?: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Represents an IMAP user account. Contains authentication credentials, server connection details, and account metadata.")
@entity("account", "remit")
@index(
  "Account",
  {
    pk: [Account.accountId],
    sk: [],
  }
)
// List all accounts for account config, part of accountConfig collection
@index(
  "byAccountConfigId",
  {
    collection: "accountConfig",
    index: "gsi1",
    pk: [Account.accountConfigId],
    sk: [Account.accountId],
  }
)
// Collection to retrieve account with all mailboxes
@index(
  "byAccountId",
  {
    collection: "account",
    index: "gsi0",
    pk: [Account.accountId],
    sk: [],
  }
)
// List all accounts (scan-like query for all records)
@index(
  "allAccounts",
  {
    index: "gsi2",
    pk: [],
    sk: [Account.accountId],
  }
)
model Account {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Reference to parent account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Login username")
  @visibility(Lifecycle.Read)
  @minLength(1)
  username: string;

  @doc("Primary email address")
  @visibility(Lifecycle.Read)
  email: string;

  @doc("Hashed password for authentication")
  @visibility(Lifecycle.Read)
  @secret
  passwordHash: string;

  // ============================================
  // IMAP Server Connection Settings
  // ============================================

  @doc("IMAP server hostname or IP address")
  @visibility(Lifecycle.Read)
  @minLength(1)
  imapHost: string;

  @doc("IMAP server port (typically 993 for TLS, 143 for STARTTLS)")
  @visibility(Lifecycle.Read)
  @minValue(1)
  @maxValue(65535)
  imapPort: int32;

  @doc("Whether to use TLS/SSL encryption (true for port 993)")
  @visibility(Lifecycle.Read)
  imapTls: boolean;

  @doc("Whether to use STARTTLS upgrade (typically for port 143)")
  @visibility(Lifecycle.Read)
  imapStartTls: boolean;

  // ============================================
  // SMTP Server Connection Settings (optional)
  // ============================================

  @doc("SMTP server hostname or IP address for sending mail")
  @visibility(Lifecycle.Read)
  smtpHost?: string;

  @doc("SMTP server port (typically 587 for STARTTLS, 465 for TLS)")
  @visibility(Lifecycle.Read)
  @minValue(1)
  @maxValue(65535)
  smtpPort?: int32;

  @doc("Whether to use TLS/SSL encryption for SMTP")
  @visibility(Lifecycle.Read)
  smtpTls?: boolean;

  @doc("Whether to use STARTTLS upgrade for SMTP")
  @visibility(Lifecycle.Read)
  smtpStartTls?: boolean;

  // ============================================
  // Connection State
  // ============================================

  @doc("Whether the account is active and can login")
  @visibility(Lifecycle.Read)
  isActive: boolean;

  @doc("Current connection state")
  @visibility(Lifecycle.Read)
  connectionState: ConnectionState;

  @doc("Timestamp of last successful connection")
  @visibility(Lifecycle.Read)
  lastConnectedAt?: int64;

  @doc("Timestamp of last synchronization attempt")
  @visibility(Lifecycle.Read)
  lastSyncAt?: int64;

  @doc("Error message from last failed connection attempt")
  @visibility(Lifecycle.Read)
  lastError?: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
