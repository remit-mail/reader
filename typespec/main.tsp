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

    @doc("List every message the sync path could not read, for the current user across all of their mail accounts (issue #72). Backs the quarantine section in settings. Unpaginated: the list is small by design, and an entry is a defect waiting to be reported rather than a page of mail.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/quarantine")
    op listQuarantine(): QuarantineListResponse;
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

    @doc("Export every configured setting for the caller as one versioned JSON document. Contains no credentials: no IMAP/SMTP password and no OAuth token, encrypted or otherwise, and the credential fields are structurally absent rather than blank. The document's own shape is not defined here - it is defined by the published JSON Schema for its `schemaVersion` (build/config-schema/reader-config.v<N>.schema.json), so a file keeps validating independent of this API's models.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/export")
    op exportConfig(): ConfigExportResponse;

    @doc("Validate, or validate and apply, a config document. `mode: validate` (the default) writes nothing and returns the same report an apply would. `onExisting: abort` (the default) refuses with 409 when this configuration already holds accounts, labels, filters or address flags. Nothing is written until the whole document has validated; a write failure after that aborts the remainder and the report names exactly what landed. Imported accounts arrive inactive with `connectionState: credentials_missing` (or `reauth_required` for OAuth) - the credentials the file deliberately omits are re-entered per account afterwards.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/import")
    op importConfig(
      @body input: ImportConfigInput,
    ): ConfigImportReport | ValidationError | ConfigImportConflict;
  }

  // ============================================
  // Standalone Self-Update Operations (RFC 037)
  // ============================================

  @route("/system/update")
  namespace SystemOperations {
    @doc("Read the self-update resource: the running version, the outcome of the most recent manifest check, and the state of the current or last run. With `refresh=true`, records a check request on the control volume for the updater to pick up and answers with the stored state as it stands; the caller watches `check.lastCheckedAt` for the updater's answer. Owner-only, and absent (404) unless a manifest URL is configured (RFC 037 D7, D8).")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getSystemUpdate(
      @query(#{ explode: true })
      refresh?: boolean,
    ): SystemUpdateResponse;

    @doc("Request installation of a specific release. Writes the request to the control seam and returns 202 with the same resource, including a runId. 409 when a run is in flight, 422 when the target is not the manifest's version. Owner-only, and absent (404) unless a manifest URL is configured (RFC 037 D7, D8).")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op applySystemUpdate(@body body: ApplyUpdateInput): SystemUpdateResponse;
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
    ): AccountResponse | AppointFolderRoleConflict;
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
    ): FilterResponse | ValidationError;
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
  // Label Operations (RFC 030 labels, #26)
  // ============================================

  @route("/accounts/{accountId}/labels")
  namespace LabelOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listLabels(
      @path accountId: UUID,

      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,
    ): ResultList<LabelResponse>;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createLabel(
      @path accountId: UUID,
      @body input: CreateLabelInput,
    ): LabelResponse;
  }

  @route("/accounts/{accountId}/labels/{labelId}")
  namespace LabelDetailOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getLabel(@path accountId: UUID, @path labelId: UUID): LabelResponse;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op updateLabel(
      @path accountId: UUID,
      @path labelId: UUID,
      @body input: UpdateLabelInput,
    ): LabelResponse;

    @doc("Delete a label. Cascades in both directions (issue #26): every `MessageLabel` row for it is removed, and every filter whose `actionLabelId` is this label is deleted outright — never left dangling, never blocking the delete. The client is expected to confirm first, naming `LabelResponse.filterCount` as the number of filters that will go with it.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteLabel(@path accountId: UUID, @path labelId: UUID): void;
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
    ): CreateOrganizeJobResponse | ValidationError;

    @doc("Preview an \"all like these\" back-apply: run the exact same matcher read-only and return the messages the action would be applied to, without applying it. The previewed set equals the set a job with the same input would apply to.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/preview")
    op previewOrganize(
      @path accountId: UUID,
      @body input: OrganizeInput,
    ): OrganizePreviewResponse | ValidationError;
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
  // Calendar Operations (issue #15, project 0)
  // ============================================

  @route("/calendars")
  namespace CalendarOperations {
    @doc("List the caller's calendar collections. Provisions the account config's default collection when it has none, so a first read never comes back empty and no client has to know how a calendar gets made.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listCalendars(): CalendarListResponse;

    @doc("Create a calendar collection. Refused with 400 when `urlSegment` is empty or already taken in this account config — the segment is the collection's identity, so a second create under the same one would otherwise silently return the collection that already exists.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createCalendar(
      @body input: CreateCalendarInput,
    ): CalendarResponse | ValidationError;
  }

  @route("/calendars/{calendarId}")
  namespace CalendarDetailOperations {
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getCalendar(@path calendarId: UUID): CalendarResponse | NotFoundError;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op updateCalendar(
      @path calendarId: UUID,
      @body input: UpdateCalendarInput,
    ): CalendarResponse | ValidationError | NotFoundError;

    @doc("Delete a calendar collection and every event in it. Refused with 400 for the account's default collection: it is the one place an accepted invitation or a first event can land, and an account with no calendar has nowhere to put an event.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteCalendar(
      @path calendarId: UUID,
    ): CalendarNoContent | ValidationError | NotFoundError;

    @doc("""
      Read whether this calendar has a feed address. Absent (404) until one is
      minted. The token is not here: it is stored as a hash, so the only
      moment it exists in the clear is the answer to the write below.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    @route("/feed")
    op getCalendarFeed(
      @path calendarId: UUID,
    ): CalendarFeedStateResponse | NotFoundError;

    @doc("""
      Mint the calendar's feed address, or replace the one it has, and answer
      with the token in the clear. Idempotent in address rather than in value:
      one calendar holds one token, so a second call rotates — the previous
      URL stops resolving, which is how a subscription handed to the wrong
      person is taken back.
      
      This is the only response that ever carries the plaintext. A client that
      does not keep it rotates again.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @put
    @route("/feed")
    op putCalendarFeed(
      @path calendarId: UUID,
    ): CalendarFeedResponse | NotFoundError;

    @doc("Revoke the calendar's feed address. Every subscribed client starts getting 404 on its next poll. Answered 404 when the calendar has no feed, so a revoke is never reported as having taken something away that was not there.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    @route("/feed")
    op revokeCalendarFeed(
      @path calendarId: UUID,
    ): CalendarNoContent | NotFoundError;
  }

  @route("/feeds/calendar")
  namespace CalendarFeedOperations {
    @doc("""
      Serve a calendar as iCalendar text to whoever holds its secret address
      (issue #1067).
      
      Outside the session-auth surface on purpose: Apple Calendar, Google
      Calendar, Outlook and Thunderbird subscribe to a URL and never sign in,
      so the token in the path is the credential and the only one. It is
      compared against the stored hash rather than looked up in the clear, and
      an unknown, revoked or malformed token is the same 404 with the same body
      — a subscriber learns whether it still has access, and nothing else.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @useAuth(NoAuth)
    @get
    @route("/{feedToken}.ics")
    op getCalendarFeedIcal(
      @doc("The calendar's secret token, base64url. Unconstrained on purpose: a length or pattern here answers an oversize or malformed address with a distinguishable 400, and error-logs the path it was refused for. The handler checks the shape itself and answers the same 404 an unknown token gets.")
      @path
      feedToken: string,

      @header("If-None-Match")
      ifNoneMatch?: string,

      @doc("HTTP-date a subscriber last saw the calendar at. Ignored when `If-None-Match` also arrives (RFC 9110 13.2.2), and compared at whole seconds, which is the resolution the `Last-Modified` it came from has.")
      @header("If-Modified-Since")
      ifModifiedSince?: string,
    ): CalendarFeedIcalResponse | CalendarFeedNotModified | CalendarFeedNotFound;
  }

  @route("/calendar-events")
  namespace CalendarEventOperations {
    @doc("""
      Expanded event occurrences in a window. The server does the recurrence
      expansion and the client renders instances — no RRULE is ever evaluated
      in a browser, so a week grid and a day strip agree with each other and
      with what a native client will later read over CalDAV.
      
      Occurrences are served from the stored occurrence index. A series whose
      index stops before `to` — an open-ended event older than the expansion
      horizon — is expanded live for this window instead, and nothing
      unbounded is written to serve a read.
      
      Refused with 400 when `from` and `to` are not ISO 8601 date-times, when
      `to` is not after `from`, or when the window is wider than a year.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listCalendarEvents(
      @doc("Start of the window, an ISO 8601 date-time with zone offset. Inclusive.")
      @query(#{ explode: true })
      from: string,

      @doc("End of the window, an ISO 8601 date-time with zone offset. Exclusive.")
      @query(#{ explode: true })
      to: string,

      @doc("Restrict to these collections, repeated once per calendar. Omitted means every calendar the caller holds.")
      @query(#{ explode: true })
      calendarId?: UUID[],
    ): CalendarEventListResponse | ValidationError | NotFoundError;

    @doc("Create an event. The server builds the VEVENT and writes it through the single calendar write path — the same one an accepted invitation and a later CalDAV PUT go through — so the object, its expanded occurrences and the collection's sync sequence land together or not at all.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    op createCalendarEvent(
      @body input: CreateCalendarEventInput,
    ): CalendarEventResponse | ValidationError | NotFoundError;
  }

  @route("/calendar-events/{calendarObjectId}")
  namespace CalendarEventDetailOperations {
    @doc("Get one stored event, including its canonical iCalendar text and its etag.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op getCalendarEvent(
      @path calendarObjectId: UUID,

      @doc("Collection the resource lives in. A resource is addressed by its collection and its own id, which is what a client holds: every occurrence a listing returns carries both.")
      @query(#{ explode: true })
      calendarId: UUID,
    ): CalendarEventResponse | ValidationError | NotFoundError;

    @doc("""
      Update an event. `scope` says what the caller meant by editing one
      drawing of a series: `All` rewrites the master, `This` writes a
      RECURRENCE-ID override for the named occurrence, and `Following` splits
      the series — the master's rule is truncated and a second resource carries
      the remainder under a UID of its own.
      
      `recurrenceId` is required for `This` and `Following` and is refused with
      400 otherwise, along with a scope other than `All` on an event that does
      not recur, and a `recurrenceId` naming no occurrence of the series.
      
      `If-Match` makes the write conditional on the etag the caller read. A
      mismatch is 412: somebody replaced the resource in between, and applying
      this patch would discard their change without either of them seeing it.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @patch(#{ implicitOptionality: true })
    op updateCalendarEvent(
      @path calendarObjectId: UUID,

      @doc("Collection the resource lives in")
      @query(#{ explode: true })
      calendarId: UUID,

      @doc("Which occurrences this update applies to. Defaults to `All`.")
      @query(#{ explode: true })
      scope?: RecurrenceScope,

      @doc("RECURRENCE-ID of the occurrence the update is anchored at, as the ISO 8601 UTC instant a listing returned. Required for `This` and `Following`.")
      @query(#{ explode: true })
      recurrenceId?: string,

      @header("If-Match")
      ifMatch?: string,

      @body input: UpdateCalendarEventInput,
    ):
      | CalendarEventResponse
      | ValidationError
      | NotFoundError
      | PreconditionFailedError;

    @doc("""
      Delete an event. `All` removes the resource and every occurrence it
      produced; `This` writes an EXDATE for the named occurrence and keeps the
      rest of the series; `Following` truncates the series to end just before
      it.
      
      Same refusals and the same `If-Match` precondition as the update.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @delete
    op deleteCalendarEvent(
      @path calendarObjectId: UUID,

      @doc("Collection the resource lives in")
      @query(#{ explode: true })
      calendarId: UUID,

      @doc("Which occurrences this delete applies to. Defaults to `All`.")
      @query(#{ explode: true })
      scope?: RecurrenceScope,

      @doc("RECURRENCE-ID of the occurrence the delete is anchored at. Required for `This` and `Following`.")
      @query(#{ explode: true })
      recurrenceId?: string,

      @header("If-Match")
      ifMatch?: string,
    ):
      | CalendarNoContent
      | ValidationError
      | NotFoundError
      | PreconditionFailedError;
  }

  @route("/calendar-free-busy")
  namespace CalendarFreeBusyOperations {
    @doc("Busy spans over a window, merged across every calendar the caller holds. Backs the clash check beside a mail invitation and the free-stretch maths in the day strip, neither of which should have to fetch every event and merge them itself. Refused with 400 on the same window rules as the event listing.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listCalendarFreeBusy(
      @doc("Start of the window, an ISO 8601 date-time with zone offset. Inclusive.")
      @query(#{ explode: true })
      from: string,

      @doc("End of the window, an ISO 8601 date-time with zone offset. Exclusive.")
      @query(#{ explode: true })
      to: string,
    ): CalendarFreeBusyResponse | ValidationError;
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
    op emptyTrash(
      @path accountId: UUID,
    ): EmptyTrashResponse | FolderRoleConflict;
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
      @query(#{ explode: true })
      code?: string,

      @query(#{ explode: true })
      state?: string,

      @query(#{ explode: true })
      error?: string,
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
      List threads across all non-muted accounts of the caller, ordered by sentDate desc. Each row carries an attached `accountId` (derived from a mailboxId→accountId map at read time) plus the usual `senderTrust` enrichment; `category` is served from the ThreadMessage row. Served by the `byDate` LSI1 (pk = the caller's account config), so the caller can never see another account config's threads.
      
      INBOX scope: results are filtered to each account's top-level INBOX, matched by exact path `fullPath === "INBOX"` (RFC 6154 defines no Inbox special-use). By design this excludes namespaced sub-paths like `INBOX/Receipts` and non-English server primaries — the unified inbox is each account's primary INBOX, not its sub-folders. Soft-deleted rows are also excluded.
      
      Mute exclusion: muted accounts and muted mailboxes are excluded. The inbox/mute filter set is rebuilt per page from live state, so muting/unmuting a mailbox mid-pagination takes effect on the next page (never retroactively).
      
      Pagination: pass the returned `continuationToken` to fetch the next page; keep paging until it is absent. In the default (INBOX) mode the INBOX/deleted filter is applied after the index read with a bounded read window per request, so a page may return FEWER than `limit` rows while still carrying a `continuationToken` — treat the presence of the token (not a full page) as the "more results" signal. No rows are skipped or duplicated across pages.
      
      Starred mode (`starred=true`): served by the `byStarred` LSI4 instead. A star is a marker on the mail rather than on its placement, so the INBOX scope does not apply and a starred thread in Archive is still returned. Excluded are muted and soft-deleted rows as usual, plus the folders a star never surfaces from: Junk, Trash, and Gmail's All Mail (a second copy of everything, whose rows would otherwise double every starred message). All filtering happens in the query, so a page is short only when the results are exhausted. Rows are per mailbox: the same mail filed in two folders is two rows sharing a `threadId`, and a client rendering one row per conversation collapses by `threadId` across the pages it has accumulated.
      
      Search mode (`query=<text>`): the listing widens past the INBOX scope to every non-muted mailbox of every non-muted account, and returns only rows whose subject or From address matches the text. This is the unscoped search of the daily brief: one query reaching every folder of every account. Whitespace splits the text into terms and every term must match (AND), each against subject OR From. Matching is case-insensitive substring, not tokenized full-text, so it neither stems nor ranks.
      
      Search scope: every non-muted mailbox EXCEPT Trash. The scope is defined by what it excludes, so anything a server offers that is not on that list is searched — Spam, Drafts and Gmail's virtual folders (All Mail, Starred, Important) included. Spam is deliberately in scope: the point of an unscoped search is that it reaches the folders the user did not think to look in. Combining `query` with `starred=true` searches the starred scope instead.
      
      Duplicates: a virtual folder holds a second copy of mail that also lives in a real folder, so a backend keying a row by its mailbox returns the same message several times — a starred, Important Gmail inbox message four times. The extras are dropped from the response by message identity, keeping the copy in a real folder, so one message is one row. This is done after the read rather than by barring those folders from the scope, because a message whose only stored row sits in one of them would otherwise become unfindable. De-duplication is per page: a duplicate split across a page boundary survives, the same caveat that applies to collapsing by `threadId`. A page may therefore return fewer rows than `limit` while still carrying a `continuationToken`.
      
      Search mode and pagination: `limit` is a page size over MATCHES, capped server-side at 500. A page may be shorter than `limit` for two reasons — the matches ran out, or duplicates were dropped from it — so treat the presence of a `continuationToken` as the "more results" signal rather than a full page. There is no total match count; page until the token is absent.
      
      What a row is in search mode: one per message, not one per mailbox. This differs from the starred mode above, where the same mail filed in two folders is two rows sharing a `threadId`. Collapsing by `threadId` is still a client's job if it renders one row per CONVERSATION, since distinct messages in one thread remain distinct rows here.
      
      Callers that omit `query` are unaffected: the INBOX (and starred) listings behave exactly as before.
      
      Row filters: `category`, `unread` and `attachments` are columns on the ThreadMessage row, so each is a predicate inside the query rather than a pass over what a page returned. They compose with every mode above — INBOX, starred and search alike — and a page therefore comes back full of matches however rare the criterion is. This is what the cross-account collections need: filtering the pages a client happens to have loaded shows an empty list whenever the matching mail sits below the newest page (#308).
      
      Counting: `count=true` answers how many CONVERSATIONS match, over the whole scope and independent of `limit`. `results=false` omits the rows, which is how a header total is read without also paying for a page of mail. Conversations rather than rows because that is what this listing renders: a row is per mailbox, so the same mail filed in two folders is two rows sharing a `threadId`, and clients collapse by it. Counting rows would put a third number beside a list that shows a second one.
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

      @doc("Filter to messages with one of these header-derived categories, as a union over the values given. Applied as a SQL predicate over the whole scope, so a page comes back full of matches however rare the category is. `uncategorized` is one of them — the pending state's name, never the absence of one.")
      @query(#{ explode: true })
      category?: MessageCategory[],

      @doc("When true, return only unread messages. A column on the row, so it narrows the query rather than the page.")
      @query(#{ explode: true })
      unread?: boolean,

      @doc("When true, return only messages carrying an attachment. A column on the row, so it narrows the query rather than the page.")
      @query(#{ explode: true })
      attachments?: boolean,

      @doc("Include how many messages the listing matches. Counted over the whole scope, independent of `limit`.")
      @query(#{ explode: true })
      count?: boolean,

      @doc("Return matching rows. Default true; set false for a count-only response.")
      @query(#{ explode: true })
      results?: boolean,
    ): ThreadSearchResponse;
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

      @doc("Filter to messages with one of these header-derived categories. Applied as a SQL predicate over the whole mailbox, so a page comes back full of matches however rare the category is. `uncategorized` is one of them.")
      @query(#{ explode: true })
      category?: MessageCategory[],

      @doc("Filter on the DKIM-alignment signal (true = DKIM mismatch). Off-row criterion; rows without an authenticity signal never match.")
      @query(#{ explode: true })
      dkimMismatch?: boolean,

      @doc("Include how many messages the query matches. Counted over the whole mailbox, independent of `limit`.")
      @query(#{ explode: true })
      count?: boolean,

      @doc("Return matching rows. Default true; set false for a count-only response.")
      @query(#{ explode: true })
      results?: boolean,

      @doc("Page size for the rows returned, capped server-side at 500. Bounds the read, not the `count`.")
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

    @doc("Reserve room on a draft for a file, and get somewhere to put it")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/attachments")
    op mintOutboxAttachment(
      @path outboxMessageId: UUID,
      @body input: MintOutboxAttachmentInput,
    ): MintOutboxAttachmentResponse | OutboxAttachmentRejected;
  }

  @route("/outbox/{outboxMessageId}/attachments/{outboxAttachmentId}")
  namespace OutboxAttachmentOperations {
    @doc("Confirm an uploaded file against the object storage now holds")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/complete")
    op completeOutboxAttachment(
      @path outboxMessageId: UUID,
      @path outboxAttachmentId: UUID,
    ): OutboxAttachmentResponse | OutboxAttachmentRejected;
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
    ): MessageBulkOperationResult | DeleteMessagesConflict;

    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/move")
    op moveMessages(@body input: MoveMessagesInput): MessageBulkOperationResult;

    @doc("Copy messages to a destination mailbox")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/copy")
    op copyMessages(
      @body input: CopyMessagesInput,
    ): MessageBulkOperationResult | MessagePlacementConflict;

    @doc("Apply or remove a label on multiple messages — the manual \"just these\" scope (RFC 034 recap, issue #26). `appliedByFilterId` stays absent on the resulting `MessageLabel` rows; that provenance is reserved for filter/organize applies.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/labels")
    op updateMessageLabels(
      @body input: UpdateMessageLabelsInput,
    ): MessageBulkOperationResult;

    @doc("Report messages as spam: block the sender (Address.flags.blocked) and move each message to the account's Junk folder. Skips the block (but still moves the message) when the sender is the account's own address. One call replaces composing the old separate `Block` and `Mark spam` actions — a single user intent, a single failure story. The sender block is written first and does not wait on the move; a failed move never rolls it back. Idempotent under a repeated call.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/report-spam")
    op reportSpam(@body input: BulkMessageInput): SpamReportBulkResult;

    @doc("Undo a spam report: clear the sender's `blocked` flag (never promotes to trusted/wellknown) and move each message back to `Message.originalMailboxId`. Idempotent under a repeated call. Each message is processed independently and concurrently, so the request's total wait is bounded by one message's settle timeout rather than accumulating across the batch.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/not-spam")
    op notSpam(@body input: BulkMessageInput): SpamReportBulkResult;
  }

  // ============================================
  // Calendar Suggestion Operations (issue #1033 stage 0.3)
  // ============================================

  @route("/calendar-suggestions")
  namespace CalendarSuggestionOperations {
    @doc("List the caller's suggestions in one state, newest first. `Pending` is the set that is waiting on a person and the one a client normally asks for.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listCalendarSuggestions(
      @query(#{ explode: true }) state: CalendarSuggestionState,

      @query(#{ explode: true })
      @continuationToken
      continuationToken?: string,
    ): ResultList<CalendarSuggestionResponse> | ValidationError;
  }

  @route("/messages/{messageId}/calendar-suggestions")
  namespace MessageCalendarSuggestionOperations {
    @doc("Every suggestion read out of one message, in whatever state each has reached — a superseded revision included, so the card can say which revision replaced it.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @get
    op listMessageCalendarSuggestions(
      @path messageId: UUID,
    ): ResultList<CalendarSuggestionResponse> | ValidationError;
  }

  @route("/calendar-suggestions/{suggestionId}")
  namespace CalendarSuggestionActionOperations {
    @doc("""
      Add the suggested event to a calendar. One transaction: a VCALENDAR is
      built from the invitation's own bytes, keeping its UID and SEQUENCE and
      marking the user `ATTENDEE;PARTSTAT=ACCEPTED`, and written through the
      same service function every other calendar write goes through — so a web
      edit and a native edit of that event cannot diverge. Accepting a `Cancel`
      suggestion writes `STATUS:CANCELLED` on the resource the same way.
      
      No reply is sent to the organizer. This endpoint sends no mail at all,
      and the card says so.
      
      Idempotent: accepting an already-accepted suggestion rewrites the same
      resource and returns the same suggestion, because both the resource id
      and the suggestion id are derived rather than minted.
      
      400 when the suggestion is not one that can be accepted — already
      declined, dismissed or superseded — or when its iCalendar will not parse.
      """)
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/accept")
    op acceptCalendarSuggestion(
      @path suggestionId: UUID,
      @body input: AcceptCalendarSuggestionInput,
    ): CalendarSuggestionResponse | ValidationError;

    @doc("Say no. Writes no calendar object and sends no reply to the organizer. Idempotent; 400 when the suggestion was already accepted, since a resource exists and declining would not remove it.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/decline")
    op declineCalendarSuggestion(
      @path suggestionId: UUID,
    ): CalendarSuggestionResponse | ValidationError;

    @doc("Wave the card away. Writes no calendar object. With `muteSender`, also writes a standing `Filter` rule on the message's sender so their invitations stop being offered. Idempotent; 400 when the suggestion was already accepted.")
    @extension("x-amazon-apigateway-integration", APIGatewayIntegration)
    @post
    @route("/dismiss")
    op dismissCalendarSuggestion(
      @path suggestionId: UUID,
      @body input: DismissCalendarSuggestionInput,
    ): CalendarSuggestionResponse | ValidationError;
  }
}
