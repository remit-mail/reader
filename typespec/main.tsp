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
  // Sync Operations
  // ============================================

  @route("/accounts/{accountId}/sync")
  namespace SyncOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op triggerSync(@path accountId: UUID): SyncTriggerResponse;
  }

  // ============================================
  // Thread Operations
  // ============================================

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
  // Message Operations
  // ============================================

  @route("/messages/{messageId}")
  namespace MessageOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op describeMessage(@path messageId: UUID): DescribeMessageResponse;

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
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/delete")
    op deleteMessages(
      @body input: BulkMessageInput,
    ): MessageBulkOperationResult;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/move")
    op moveMessages(@body input: MoveMessagesInput): MessageBulkOperationResult;
  }
}
