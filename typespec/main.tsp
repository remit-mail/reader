import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

// Extensions and utilities
import "./lib/extensions/api-gateway.tsp";
import "./lib/util.tsp";
import "./lib/errors.tsp";
import "./lib/cognito-auth.tsp";

// Scalars
import "./lib/scalars/string.tsp";

// Enums
import "./lib/enums/index.tsp";

// Models
import "./lib/models/index.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@doc("IMAP Mailbox Entity Model based on RFC 9051 (IMAP4rev2) and RFC 2822 (Internet Message Format)")
namespace RemitImap;

// ============================================
// API Service Definition
// ============================================

@useAuth(CognitoAuthorizer)
@service(#{ title: "Remit Mail Inspector API" })
@server("https://api.remit.example.com", "Remit API Server")
namespace RemitApi {
  // ============================================
  // User Self-Service Operations
  // ============================================

  @route("/me")
  namespace MeOperations {
    @doc("Request full erasure of the current user's account and all associated data")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteMe(): DeleteAccountConfigResponse;

    @doc("List wellknown senders the user has not yet promoted to VIP. Ranked by `replyCount + inboundCount` desc with `lastInboundAt` desc as the tie-breaker. Capped at 10.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/vip-suggestions")
    op listVipSuggestions(): VipSuggestionsResponse;
  }

  // ============================================
  // Admin Operations
  // ============================================

  @route("/admin/accountConfigs/{accountConfigId}")
  namespace AdminAccountConfigOperations {
    @doc("Finalize deletion of an account config after cascading cleanup is complete")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/finalize-delete")
    op adminFinalizeDelete(@path accountConfigId: UUID): void;
  }

  // ============================================
  // Configuration Operations
  // ============================================

  @route("/config")
  namespace ConfigOperations {
    @doc("Get the current user's configuration including accounts and addresses")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getConfig(): ConfigDescriptionResponse;
  }

  // ============================================
  // Account Mailbox Operations
  // ============================================

  @route("/accounts/{accountId}/mailboxes")
  namespace MailboxOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listMailboxes(
      @path accountId: UUID,

      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,
    ): ResultList<MailboxResponse>;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createMailbox(
      @path accountId: UUID,
      @body input: CreateMailboxInput,
    ): MailboxResponse;
  }

  @route("/accounts/{accountId}/mailboxes/{mailboxId}")
  namespace MailboxDetailOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getMailbox(
      @path accountId: UUID,
      @path mailboxId: UUID,
    ): MailboxResponse;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op renameMailbox(
      @path accountId: UUID,
      @path mailboxId: UUID,
      @body input: RenameMailboxInput,
    ): MailboxResponse;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteMailbox(@path accountId: UUID, @path mailboxId: UUID): void;
  }

  // ============================================
  // Trash Operations
  // ============================================

  @route("/accounts/{accountId}/trash")
  namespace TrashOperations {
    @doc("Permanently delete all messages in the Trash mailbox")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/empty")
    op emptyTrash(@path accountId: UUID): EmptyTrashResponse;
  }

  // ============================================
  // Sync Operations
  // ============================================

  @route("/accounts/{accountId}/sync")
  namespace SyncOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op triggerSync(@path accountId: UUID): SyncTriggerResponse;
  }

  // ============================================
  // Account Management Operations
  // ============================================

  @route("/accounts")
  namespace AccountOperations {
    @doc("Create a new email account")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createAccount(@body input: CreateAccountInput): AccountResponse;

    @doc("Test IMAP/SMTP connection without saving")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/test-connection")
    op testConnection(@body input: TestConnectionInput): TestConnectionResponse;
  }

  @route("/accounts/{accountId}")
  namespace AccountDetailOperations {
    @doc("Update an existing account")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op updateAccount(
      @path accountId: UUID,
      @body input: UpdateAccountInput,
    ): AccountResponse;

    @doc("Delete an account and all associated data")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteAccount(@path accountId: UUID): DeleteAccountResponse;
  }

  // ============================================
  // Thread Operations
  // ============================================

  @route("/threads/{threadId}/messages")
  namespace ThreadDetailOperations {
    @doc("Get all messages in a thread. Optionally filter by mailboxId to deduplicate when messages exist in multiple mailboxes.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listThreadMessages(
      @path threadId: UUID,

      @query(#{ explode: true })
      order?: SortOrder,

      @doc("Filter messages to only those in this mailbox (useful for deduplication)")
      @query(#{ explode: true })
      mailboxId?: UUID,
    ): ResultList<ThreadMessageResponse>;
  }

  @route("/mailboxes/{mailboxId}/threads")
  namespace ThreadOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listThreads(
      @path mailboxId: UUID,

      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,

      @query(#{ explode: true })
      order?: SortOrder,
    ): ResultList<ThreadMessageResponse>;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/search")
    op searchThreads(
      @path mailboxId: UUID,

      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,

      @query(#{ explode: true })
      order?: SortOrder,

      @query(#{ explode: true })
      query?: string,

      @query(#{ explode: true })
      subject?: string,

      @query(#{ explode: true })
      from?: string,

      @query(#{ explode: true })
      unread?: boolean,

      @query(#{ explode: true })
      starred?: boolean,

      @query(#{ explode: true })
      attachments?: boolean,
    ): ResultList<ThreadMessageResponse>;
  }

  // ============================================
  // Semantic Search Operations
  // ============================================

  @route("/search/semantic")
  namespace SemanticSearchOperations {
    @doc("Run a semantic vector search across the caller's indexed messages.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op semanticSearch(
      @doc("Free-form natural-language query")
      @query(#{ explode: true })
      query: string,

      @doc("Restrict results to a single mailbox")
      @query(#{ explode: true })
      mailboxId?: UUID,

      @doc("Lower bound on sentDate (epoch seconds, inclusive)")
      @query(#{ explode: true })
      sentDateFrom?: int64,

      @doc("Upper bound on sentDate (epoch seconds, inclusive)")
      @query(#{ explode: true })
      sentDateTo?: int64,

      @doc("Restrict to messages with or without attachments")
      @query(#{ explode: true })
      hasAttachment?: boolean,

      @doc("Restrict to starred or unstarred messages")
      @query(#{ explode: true })
      hasStars?: boolean,

      @doc("Restrict to read or unread messages")
      @query(#{ explode: true })
      isRead?: boolean,

      @doc("Maximum number of results to return")
      @query(#{ explode: true })
      limit?: int32,
    ): {
      items: SemanticSearchResult[];
    };
  }

  // ============================================
  // Outbox Operations
  // ============================================

  @route("/outbox")
  namespace OutboxOperations {
    @doc("Create a new outbox message (draft or send immediately)")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createOutboxMessage(
      @body input: CreateOutboxMessageInput,
    ): OutboxMessageResponse;

    @doc("List outbox messages for the current account")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listOutboxMessages(
      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,
    ): ResultList<OutboxMessageResponse>;
  }

  @route("/outbox/{outboxMessageId}")
  namespace OutboxDetailOperations {
    @doc("Get an outbox message by ID")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getOutboxMessage(@path outboxMessageId: UUID): OutboxMessageResponse;

    @doc("Update a draft outbox message")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op updateOutboxMessage(
      @path outboxMessageId: UUID,
      @body input: UpdateOutboxMessageInput,
    ): OutboxMessageResponse;

    @doc("Delete a draft or failed outbox message")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteOutboxMessage(@path outboxMessageId: UUID): void;

    @doc("Queue a draft message for sending")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/send")
    op sendOutboxMessage(@path outboxMessageId: UUID): OutboxMessageResponse;
  }

  // ============================================
  // Address Search Operations
  // ============================================

  @route("/addresses")
  namespace AddressOperations {
    @doc("Search addresses for autocomplete")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/search")
    op searchAddresses(
      @query(#{ explode: true }) q: string,
      @query(#{ explode: true }) limit?: int32,
    ): ResultList<AddressResponse>;
  }

  @route("/addresses/{addressId}")
  namespace AddressDetailOperations {
    @doc("Update an address (currently: per-sender flags). Pass `flags: { <name>: null }` to remove a flag. Other flags are untouched.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op updateAddress(
      @path addressId: UUID,
      @body input: UpdateAddressInput,
    ): AddressResponse;
  }

  // ============================================
  // Message Operations
  // ============================================

  @route("/messages/{messageId}")
  namespace MessageOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op describeMessage(@path messageId: UUID): DescribeMessageResponse;

    @doc("Get the raw RFC822/MIME source of a message (headers and body) for inspection.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/raw")
    op getRawMessage(@path messageId: UUID): RawMessageResponse;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    @route("/flags")
    op updateMessageFlags(
      @path messageId: UUID,
      @body input: UpdateFlagsInput,
    ): {
      messageId: UUID;
      isRead: boolean;
      isStarred: boolean;
    };
  }

  @route("/messages")
  namespace MessageBulkOperations {
    @doc("Update flags on multiple messages")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/flags")
    op updateFlags(
      @body input: BulkUpdateFlagsInput,
    ): MessageBulkOperationResult;

    @doc("Delete messages (move to Trash or permanent delete)")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/delete")
    op deleteMessages(
      @body input: DeleteMessagesInput,
    ): MessageBulkOperationResult;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/move")
    op moveMessages(@body input: MoveMessagesInput): MessageBulkOperationResult;

    @doc("Copy messages to a destination mailbox")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/copy")
    op copyMessages(@body input: CopyMessagesInput): MessageBulkOperationResult;
  }
}
