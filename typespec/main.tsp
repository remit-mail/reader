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
    op deleteMe(
      @body body: DeleteMeInput,
    ): DeleteAccountConfigResponse | ValidationError;

    @doc("List wellknown senders the user has not yet promoted to VIP. Ranked by `replyCount + inboundCount` desc with `lastInboundAt` desc as the tie-breaker. Capped at 10.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/vip-suggestions")
    op listVipSuggestions(): VipSuggestionsResponse;

    @doc("Request an export of all account data as a ZIP archive of .eml files. Returns immediately with an exportId; check GET /me/export/{exportId} for status and downloadUrl.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/export")
    op createExport(): CreateExportResponse;

    @doc("Get the status of a previously requested data export. When state is Ready, downloadUrl holds a 30-day presigned S3 URL.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/export/{exportId}")
    op getExport(@path exportId: string): AccountExportRequestResponse;
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
  // Folder Role Operations (RFC 032 exclusive-folder-appointment, #976)
  // ============================================

  @route("/accounts/{accountId}/folder-roles/{role}")
  namespace FolderRoleOperations {
    @doc("Appoint a canonical role to a mailbox, or clear it. Exclusive by construction: the role always resolves to exactly one mailbox, so appointing a new one silently replaces whichever mailbox previously held it — there is no second place a duplicate appointment could live. Returns the account with its refreshed folderAppointments.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @put
    op appointFolderRole(
      @path accountId: UUID,
      @path role: CanonicalMailboxRole,
      @body input: AppointFolderRoleInput,
    ): AccountResponse;
  }

  // ============================================
  // Filter Operations (RFC 034 smart-organize filters, #1276)
  // ============================================

  @route("/accounts/{accountId}/filters")
  namespace FilterOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listFilters(
      @path accountId: UUID,

      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,
    ): ResultList<FilterResponse>;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createFilter(
      @path accountId: UUID,
      @body input: CreateFilterInput,
    ): FilterResponse;
  }

  @route("/accounts/{accountId}/filters/{filterId}")
  namespace FilterDetailOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getFilter(@path accountId: UUID, @path filterId: UUID): FilterResponse;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op updateFilter(
      @path accountId: UUID,
      @path filterId: UUID,
      @body input: UpdateFilterInput,
    ): FilterResponse;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteFilter(@path accountId: UUID, @path filterId: UUID): void;
  }

  // ============================================
  // Smart Organize Back-Apply Operations (RFC 034 "all like these", #1278)
  // ============================================

  @route("/accounts/{accountId}/organize")
  namespace OrganizeOperations {
    @doc("Start a one-time \"all like these\" back-apply: match the corpus against the given predicate and apply the action to every match, in one pass. Returns immediately with an organizeJobId; poll GET /accounts/{accountId}/organize/{organizeJobId} for state and counts. Never creates a Filter or FilterAnchor row (RFC 034 recap).")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createOrganizeJob(
      @path accountId: UUID,
      @body input: OrganizeInput,
    ): CreateOrganizeJobResponse;

    @doc("Preview an \"all like these\" back-apply: run the exact same matcher read-only and return the messages the action would be applied to, without applying it. The previewed set equals the set a job with the same input would apply to.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/preview")
    op previewOrganize(
      @path accountId: UUID,
      @body input: OrganizeInput,
    ): OrganizePreviewResponse;
  }

  @route("/accounts/{accountId}/organize/{organizeJobId}")
  namespace OrganizeJobDetailOperations {
    @doc("Get the status of a back-apply job, including matched/applied/failed counts. Terminal states are Complete and Failed.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getOrganizeJob(
      @path accountId: UUID,
      @path organizeJobId: UUID,
    ): OrganizeJobResponse;
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

    @doc("Get the current sync status for an account, including per-mailbox progress computed from watermarks. Read-only — does not write or contend with the mailbox sync lock (RFC 023).")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/status")
    op getSyncStatus(@path accountId: UUID): AccountSyncStatusResponse;
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

  // ============================================
  // Microsoft OAuth Operations
  // ============================================

  model MicrosoftOAuthStartRequest {
    @doc("Optional email hint for the Microsoft login page")
    email?: string;
  }

  model MicrosoftOAuthStartResponse {
    @doc("The Microsoft authorization URL to redirect the user to")
    authorizationUrl: string;
  }

  @route("/accounts/oauth/microsoft")
  namespace MicrosoftOAuthOperations {
    @doc("Start Microsoft OAuth2 authorization flow")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/start")
    op microsoftOAuthStart(
      @body input: MicrosoftOAuthStartRequest,
    ): MicrosoftOAuthStartResponse;

    @doc("Microsoft OAuth2 callback endpoint — receives the authorization code from Microsoft and exchanges it for tokens. This endpoint is intentionally unauthenticated: the browser is redirected here by Microsoft after the user grants consent, before any Cognito session is available. CSRF is prevented by an HMAC-signed state parameter.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @useAuth(NoAuth)
    @get
    @route("/callback")
    op microsoftOAuthCallback(
      @query code?: string,
      @query state?: string,
      @query error?: string,
    ): {
      @statusCode statusCode: 302;
      @header Location: string;
    };
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
    @doc("""
      Get all messages in a thread, across every mailbox of the account — a conversation spans INBOX, Sent, Archive and any folder the user filed a message in, so it is never scoped to one mailbox. Soft-deleted messages (including anything moved to Trash) are excluded.
      
      One entry per piece of mail. A message synced from several folders is stored once, and where a second row exists for the same Message-ID — a copy taken with `copyMessages`, which gives its copy a fresh message id — the oldest is returned and the rest are dropped.
      
      Ordering: oldest first, by the date the message was sent, with `threadMessageId` breaking ties. A conversation is read in the order it happened, so a reply always follows the message it answers. Pass `order=desc` for the reverse.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listThreadMessages(
      @path threadId: UUID,

      @query(#{ explode: true })
      order?: SortOrder,
    ): ResultList<ThreadMessageResponse>;
  }

  @route("/threads")
  namespace UnifiedThreadOperations {
    @doc("""
      List threads across all non-muted accounts of the caller, ordered by sentDate desc. Each row carries an attached `accountId` (derived from a mailboxId→accountId map at read time) plus the usual `senderTrust`/`category` enrichment. Served by the `byDate` LSI1 (pk = the caller's account config), so the caller can never see another account config's threads.
      
      INBOX scope: results are filtered to each account's top-level INBOX, matched by exact path `fullPath === "INBOX"` (RFC 6154 defines no Inbox special-use). By design this excludes namespaced sub-paths like `INBOX/Receipts` and non-English server primaries — the unified inbox is each account's primary INBOX, not its sub-folders. Soft-deleted rows are also excluded.
      
      Mute exclusion: muted accounts and muted mailboxes are excluded. The inbox/mute filter set is rebuilt per page from live state, so muting/unmuting a mailbox mid-pagination takes effect on the next page (never retroactively).
      
      Pagination: pass the returned `continuationToken` to fetch the next page; keep paging until it is absent. In the default (INBOX) mode the INBOX/deleted filter is applied after the index read with a bounded read window per request, so a page may return FEWER than `limit` rows while still carrying a `continuationToken` — treat the presence of the token (not a full page) as the "more results" signal. No rows are skipped or duplicated across pages.
      
      Starred mode (`starred=true`): served by the `byStarred` LSI4 instead. A star is a marker on the mail rather than on its placement, so the INBOX scope does not apply and a starred thread in Archive is still returned. Excluded are muted and soft-deleted rows as usual, plus the folders a star never surfaces from: Junk, Trash, and Gmail's All Mail (a second copy of everything, whose rows would otherwise double every starred message). All filtering happens in the query, so a page is short only when the results are exhausted. Rows are per mailbox: the same mail filed in two folders is two rows sharing a `threadId`, and a client rendering one row per conversation collapses by `threadId` across the pages it has accumulated.
      
      Search mode (`query=<text>`): the listing widens past the INBOX scope to every non-muted mailbox of every non-muted account — Archive, Sent, Spam and any custom folder — and returns only rows whose subject or From address matches the text. This is the unscoped search of the daily brief: one query reaching every folder of every account. Whitespace splits the text into terms and every term must match (AND), each against subject OR From. Matching is case-insensitive substring, not tokenized full-text, so it neither stems nor ranks. Excluded from the search scope are Trash and Gmail's All Mail: Trash holds mail the user discarded, and All Mail is a second copy of everything already reachable through its own folder, whose rows would otherwise double every Gmail result. Spam is in scope — the point of an unscoped search is that it reaches the folders the user did not think to look in. Combining `query` with `starred=true` searches the starred scope instead.
      
      Search mode and pagination: filtering happens in the query, so a page is short only when the matches are exhausted; `limit` is a page size over MATCHES, capped server-side at 500. Rows are per mailbox as in starred mode — the same mail filed in two folders is two rows sharing a `threadId` — so a client rendering one row per conversation collapses by `threadId`. There is no total match count; page until `continuationToken` is absent.
      
      Callers that omit `query` are unaffected: the INBOX (and starred) listings behave exactly as before.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listAllThreads(
      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,

      @query(#{ explode: true })
      order?: SortOrder,

      @query(#{ explode: true })
      limit?: int32,

      @doc("When true, return only starred threads — every starred thread in the config, across all non-muted mailboxes, not just the INBOX scope. Starredness is read from `hasStars`, the boolean of record.")
      @query(#{ explode: true })
      starred?: boolean,

      @doc("Free text to match against subject and From address. Supplying it switches the listing into search mode, which widens the scope past INBOX to every non-muted mailbox — see the operation description. Omitting it leaves the listing unchanged.")
      @query(#{ explode: true })
      query?: string,
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

      @doc("Filter to messages whose From address has one of these trust levels. Off-row criterion, resolved by in-handler enrichment over the capped window.")
      @query(#{ explode: true })
      senderTrust?: SenderTrust[],

      @doc("Filter to messages with one of these header-derived categories. Off-row criterion, resolved by in-handler enrichment over the capped window.")
      @query(#{ explode: true })
      category?: MessageCategory[],

      @doc("Filter on the DKIM-alignment signal (true = DKIM mismatch). Off-row criterion; rows without an authenticity signal never match.")
      @query(#{ explode: true })
      dkimMismatch?: boolean,

      @doc("Include a count of matches within the server-capped window.")
      @query(#{ explode: true })
      count?: boolean,

      @doc("Return matching rows. Default true; set false for a count-only response.")
      @query(#{ explode: true })
      results?: boolean,

      @doc("Caller-set recency window, capped server-side at 500. Bounds the read.")
      @query(#{ explode: true })
      limit?: int32,
    ): ThreadSearchResponse;
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

      @doc("Restrict results to a single header-derived category")
      @query(#{ explode: true })
      category?: MessageCategory,

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
