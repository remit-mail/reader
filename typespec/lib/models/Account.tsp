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

@doc("Represents an IMAP user account. Contains authentication credentials and account metadata.")
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

  @doc("Whether the account is active and can login")
  @visibility(Lifecycle.Read)
  isActive: boolean;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
