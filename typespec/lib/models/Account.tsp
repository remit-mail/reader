import "typespec-electrodb-emitter";
import "@typespec/http";

import "../enums/ConnectionState.tsp";
import "../enums/AccountConfigState.tsp";
import "../enums/SyncPhase.tsp";
import "../scalars/string.tsp";
import "./Address.tsp";

using TypeSpec.Http;

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

  @doc("Lifecycle state of this account configuration")
  @visibility(Lifecycle.Read)
  state: AccountConfigState = AccountConfigState.Active;

  @doc("Timestamp when deletion was requested (tombstone)")
  @visibility(Lifecycle.Read)
  deletedAt?: int64;

  @doc("Timestamp when cascading cleanup started (idempotency fence)")
  @visibility(Lifecycle.Read)
  cascadeStartedAt?: int64;

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

  @doc("SMTP login username (may differ from IMAP username)")
  @visibility(Lifecycle.Read)
  smtpUsername?: string;

  @doc("Hashed password for SMTP authentication (may differ from IMAP)")
  @visibility(Lifecycle.Read)
  @secret
  smtpPasswordHash?: string;

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

  // ============================================
  // Sync Progress
  // ============================================

  @doc("Current phase of the initial account sync lifecycle")
  @visibility(Lifecycle.Read)
  syncPhase?: SyncPhase;

  @doc("Total number of mailboxes discovered during sync")
  @visibility(Lifecycle.Read)
  @minValue(0)
  mailboxCountTotal?: int32;

  @doc("Number of mailboxes whose initial message sync has completed")
  @visibility(Lifecycle.Read)
  @minValue(0)
  mailboxCountSynced?: int32;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;

  // ============================================
  // Signature Settings
  // ============================================

  @doc("Plain text email signature")
  @visibility(Lifecycle.Read)
  signaturePlainText?: string;

  @doc("HTML email signature")
  @visibility(Lifecycle.Read)
  signatureHtml?: string;

  @doc("Timestamp when account was marked for deletion (tombstone)")
  @visibility(Lifecycle.Read)
  deletedAt?: int64;

  @doc("Account-level mute flag. When set, all mailboxes of this account are hidden from unified/brief views (sync is unaffected). Use the existing PATCH endpoint to set or clear; pass `null` to remove.")
  @visibility(Lifecycle.Read, Lifecycle.Update)
  muted?: MutedFlag;
}

// ============================================
// API Response Models
// ============================================

@doc("Sync trigger response")
model SyncTriggerResponse {
  @doc("Whether sync was triggered successfully")
  triggered: boolean;

  @doc("Message about sync status")
  message: string;
}

@doc("Per-mailbox progress entry in the sync-status response")
model MailboxSyncProgress {
  @doc("Mailbox identifier")
  mailboxId: UUID;

  @doc("Full IMAP path (e.g. INBOX, Sent)")
  fullPath: string;

  @doc("Sync phase for this mailbox: pending (never synced), syncing (in-progress), or complete")
  phase: string;

  @doc("Total messages in mailbox (refreshed each batch)")
  messagesTotal: int32;

  @doc("Approximate number of messages synced. Computed as highWaterMarkUid − lastSyncUid (UID-range approximation; UIDs are sparse so this may undercount). Clamped to messagesTotal.")
  messagesSynced: int32;

  @doc("Timestamp of the last successful message sync for this mailbox")
  lastSyncedAt?: int64;
}

@doc("Aggregate sync-status response for an account")
model AccountSyncStatusResponse {
  @doc("Account identifier")
  accountId: UUID;

  @doc("Current sync phase for the account")
  syncPhase?: SyncPhase;

  @doc("Total number of mailboxes discovered")
  mailboxCountTotal?: int32;

  @doc("Number of mailboxes whose initial message sync has completed")
  mailboxCountSynced?: int32;

  @doc("Per-mailbox sync progress")
  mailboxes: MailboxSyncProgress[];
}

@doc("Account configuration response")
model AccountConfigResponse
  is PickProperties<
    AccountConfig,

      | "accountConfigId"
      | "userId"
      | "name"
      | "state"
      | "deletedAt"
      | "cascadeStartedAt"
      | "createdAt"
      | "updatedAt"
  >;

@doc("Account response (excluding sensitive fields)")
model AccountResponse
  is PickProperties<
    Account,

      | "accountId"
      | "accountConfigId"
      | "username"
      | "email"
      | "imapHost"
      | "imapPort"
      | "imapTls"
      | "imapStartTls"
      | "smtpHost"
      | "smtpPort"
      | "smtpTls"
      | "smtpStartTls"
      | "smtpUsername"
      | "isActive"
      | "connectionState"
      | "lastConnectedAt"
      | "lastSyncAt"
      | "lastError"
      | "syncPhase"
      | "mailboxCountTotal"
      | "mailboxCountSynced"
      | "signaturePlainText"
      | "signatureHtml"
      | "muted"
      | "createdAt"
      | "updatedAt"
  >;

@doc("Address response for address book entries")
model AddressResponse
  is PickProperties<
    Address,

      | "addressId"
      | "accountConfigId"
      | "displayName"
      | "localPart"
      | "domain"
      | "normalizedEmail"
      | "flags"
      | "createdAt"
      | "updatedAt"
  >;

@doc("Full configuration description including accounts")
model ConfigDescriptionResponse {
  @doc("The account configuration")
  accountConfig: AccountConfigResponse;

  @doc("Associated email accounts")
  accounts: AccountResponse[];
}

// ============================================
// Account Management Input Models
// ============================================

@doc("Input for creating a new email account")
model CreateAccountInput {
  @doc("Primary email address for this account")
  @minLength(1)
  email: string;

  @doc("Display name (optional)")
  displayName?: string;

  @doc("IMAP login username (defaults to email if not provided)")
  username?: string;

  @doc("Account password (will be encrypted)")
  @minLength(1)
  @secret
  password: string;

  @doc("IMAP server hostname")
  @minLength(1)
  imapHost: string;

  @doc("IMAP server port")
  @minValue(1)
  @maxValue(65535)
  imapPort: int32;

  @doc("Use TLS encryption")
  imapTls: boolean;

  @doc("Use STARTTLS upgrade")
  imapStartTls: boolean;

  @doc("SMTP server hostname (optional)")
  smtpHost?: string;

  @doc("SMTP server port")
  @minValue(1)
  @maxValue(65535)
  smtpPort?: int32;

  @doc("Use TLS encryption for SMTP")
  smtpTls?: boolean;

  @doc("Use STARTTLS upgrade for SMTP")
  smtpStartTls?: boolean;

  @doc("SMTP username if different from IMAP")
  smtpUsername?: string;

  @doc("SMTP password if different from IMAP")
  @secret
  smtpPassword?: string;
}

@doc("Input for updating an existing account")
model UpdateAccountInput {
  @doc("Display name")
  displayName?: string;

  @doc("Account password (only if changing)")
  @secret
  password?: string;

  @doc("IMAP server hostname")
  imapHost?: string;

  @doc("IMAP server port")
  @minValue(1)
  @maxValue(65535)
  imapPort?: int32;

  @doc("Use TLS encryption")
  imapTls?: boolean;

  @doc("Use STARTTLS upgrade")
  imapStartTls?: boolean;

  @doc("SMTP server hostname")
  smtpHost?: string;

  @doc("SMTP server port")
  @minValue(1)
  @maxValue(65535)
  smtpPort?: int32;

  @doc("Use TLS encryption for SMTP")
  smtpTls?: boolean;

  @doc("Use STARTTLS upgrade for SMTP")
  smtpStartTls?: boolean;

  @doc("SMTP username")
  smtpUsername?: string;

  @doc("SMTP password (only if changing)")
  @secret
  smtpPassword?: string;

  @doc("Enable/disable account")
  isActive?: boolean;

  @doc("Plain text email signature")
  signaturePlainText?: string;

  @doc("HTML email signature")
  signatureHtml?: string;

  @doc("Account-level mute flag. Pass a MutedFlag object to mute; pass `null` to clear the mute.")
  muted?: MutedFlag | null;
}

@doc("Input for testing connection without saving")
model TestConnectionInput {
  @doc("Account ID (optional, used to retrieve stored password if password is empty)")
  accountId?: UUID;

  @doc("IMAP login username")
  @minLength(1)
  username: string;

  @doc("Account password (optional if accountId provided - uses stored password)")
  @secret
  password?: string;

  @doc("IMAP server hostname")
  @minLength(1)
  imapHost: string;

  @doc("IMAP server port")
  @minValue(1)
  @maxValue(65535)
  imapPort: int32;

  @doc("Use TLS encryption")
  imapTls: boolean;

  @doc("Use STARTTLS upgrade")
  imapStartTls: boolean;

  @doc("SMTP server hostname (optional)")
  smtpHost?: string;

  @doc("SMTP server port")
  @minValue(1)
  @maxValue(65535)
  smtpPort?: int32;

  @doc("Use TLS encryption for SMTP")
  smtpTls?: boolean;

  @doc("Use STARTTLS upgrade for SMTP")
  smtpStartTls?: boolean;

  @doc("SMTP username (defaults to IMAP username)")
  smtpUsername?: string;

  @doc("SMTP password (defaults to IMAP password)")
  @secret
  smtpPassword?: string;
}

@doc("Connection test result")
model TestConnectionResponse {
  @doc("Whether IMAP connection succeeded")
  imapSuccess: boolean;

  @doc("IMAP error message if failed")
  imapError?: string;

  @doc("Whether SMTP connection succeeded (null if not tested)")
  smtpSuccess?: boolean;

  @doc("SMTP error message if failed")
  smtpError?: string;
}

@doc("Response for DELETE /me (account erasure request)")
model DeleteAccountConfigResponse {
  @statusCode statusCode: 202;

  @doc("Human-readable confirmation message")
  message: string;
}

@doc("Delete account response (tombstone)")
model DeleteAccountResponse {
  @doc("Account ID that was marked for deletion")
  accountId: UUID;

  @doc("Timestamp when deletion was requested")
  deletedAt: int64;

  @doc("Message indicating async cleanup will follow")
  message: string;
}
