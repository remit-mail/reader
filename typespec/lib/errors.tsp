import "@typespec/http";

using TypeSpec.Http;

@doc("""
  Every error the API answers with, whatever the status. The body is flat:
  `code`, `message` and `details` sit at the top level, with no envelope around
  them.
  
  `code` is always present and is the only field a client branches on. It is a
  stable snake_case token — the refusal's own where it has one
  (`folder_role_unresolved`, `config_not_empty`), and otherwise the status
  class's: `invalid_request`, `unauthorized`, `forbidden`, `not_found`,
  `conflict`, `precondition_failed`, `payload_too_large`,
  `unprocessable_entity`, `internal_error`, and `request_refused` for a 4xx no
  operation declares (405, 408, 415, 429).
  
  `message` is a sentence for a person and is free to change; nothing may parse
  it. `details` carries the strings a client words its own prompt from, and a
  5xx never carries one — an internal failure answers with its status code and
  message and nothing else.
  """)
model ApiError {
  @doc("Stable token naming the refusal. Branch on this, never on `message`.")
  code: string;

  @doc("Human-readable error message")
  message: string;

  @doc("Additional error details")
  details?: Record<string>;
}

@doc("One reason a request was refused, as the validator read it. Named fields only — nothing here echoes the value that was submitted.")
model RequestValidationDetail {
  @doc("JSON Pointer to the offending value; empty for the document itself")
  path: string;

  @doc("The rule that refused it, e.g. `required`, `type`, `format`")
  rule: string;

  @doc("What the validator said")
  message: string;
}

@doc("""
  The request was refused as malformed or contradictory. `code` is
  `invalid_request` where nothing more specific is known, and the refusal's own
  token where there is one.
  
  The calendar surface answers with the reason it read the request by:
  `invalid_window`, `invalid_scope`, `invalid_url_segment`, `url_segment_taken`,
  `unknown_time_zone` and `default_calendar_undeletable` on the collection and
  the query, and, for a VCALENDAR it could not accept,
  `malformed_icalendar`, `not_a_calendar`, `unsupported_component`, `no_event`,
  `no_master_event`, `multiple_master_events`, `missing_uid`, `mismatched_uid`,
  `missing_dt_start`, `backwards_end`, `invalid_date_time`,
  `invalid_recurrence_rule`, `missing_recurrence_id`, `not_recurring` and
  `unknown_occurrence`.
  
  `errors` is present only when the request failed schema validation before any
  handler ran, and names every field that was refused.
  """)
model ValidationError {
  @statusCode statusCode: 400;
  ...ApiError;

  @doc("Every field the schema refused, when the refusal came from schema validation")
  errors?: RequestValidationDetail[];
}

@doc("The request carried no usable credential. `code` is `unauthorized`.")
model UnauthorizedError {
  @statusCode statusCode: 401;
  ...ApiError;
}

@doc("The caller is known and may not do this. `code` is `forbidden`.")
model ForbiddenError {
  @statusCode statusCode: 403;
  ...ApiError;
}

@doc("Nothing answers to this address, or the caller may not learn that something does. `code` is `not_found`.")
model NotFoundError {
  @statusCode statusCode: 404;
  ...ApiError;
}

@doc("""
  The request contradicts the state the resource is in. `code` is `conflict`
  unless the refusal names its own — see `FolderRoleConflict`,
  `MessagePlacementConflict` and `ConfigImportConflict`.
  """)
model ConflictError {
  @statusCode statusCode: 409;
  ...ApiError;
}

@doc("""
  The condition the request stated is no longer true. Answered when an
  `If-Match` names an etag the stored resource no longer carries: somebody else
  wrote it in between, so applying this request would silently discard their
  change. The client re-reads the resource and decides what to do with the
  version it now has. `code` is `precondition_failed`.
  """)
model PreconditionFailedError {
  @statusCode statusCode: 412;
  ...ApiError;
}

@doc("The request is well-formed but the thing it names cannot be produced. `code` is `unprocessable_entity`.")
model UnprocessableEntityError {
  @statusCode statusCode: 422;
  ...ApiError;
}

@doc("The server failed. `code` is `internal_error` and `details` is never present — nothing about the failure leaves the process beyond its message.")
model InternalServerError {
  @statusCode statusCode: 500;
  ...ApiError;
}

@doc("""
  An action was refused because the folder role it needs is not settled. The body is flat: `code`, `message` and `details` sit at the top level, which is what the API emits. Clients branch on `code` and word their prompt from `details`, never from `message`.
  
  `code: "folder_role_unresolved"` — no folder holds the role this action needs. `details` carries `role`, `accountId`, and `reason`, one of: `none` (the account has no candidate folder), `stale` (the folder the user appointed is gone from the mail server), `unconfirmed` (a folder matches by name, but neither the user nor the server's own flag ever said it holds the role).
  """)
model FolderRoleConflict {
  @statusCode statusCode: 409;
  ...ApiError;
}

@doc("""
  The same flat 409 body as `FolderRoleConflict`, with the codes only this endpoint can answer with.
  
  `code: "folder_role_unresolved"` — as everywhere else, with `details` carrying `role`, `accountId` and `reason`.
  """)
model AppointFolderRoleConflict is FolderRoleConflict;

@doc("""
  The write binds a durable reference — a role appointment, a filter's move target, a message's destination — to a folder whose own mutation has not settled, so the reference would point at something that may never exist.
  
  `code: "mailbox_not_settled"` — `details` carries `mailboxId` and `syncStatus`, one of `pending` (the mail server has not confirmed the folder yet), `deleting` (it is on its way out) or `failed` (its last rename or delete did not land, and the user has a retry or a dismissal to make first). Clearing a reference is never refused this way, and neither is moving mail *out of* such a folder.
  
  422 rather than a second 409: 409 means somebody else is changing this folder right now and the client should refresh, which is different copy and a different remedy.
  """)
model MailboxNotSettled {
  @statusCode statusCode: 422;
  ...ApiError;
}

@doc("""
  The same flat 409 body, for a message whose folder and uid do not name the same message.
  
  `code: "message_placement_unsettled"` — the message is mid-move, so its row names the destination folder while its uid still belongs to the source; acting on that pair would hit whatever the destination holds at that uid. `details` carries `accountId`, `messageId` and `reason`, one of: `in_flight` (the move is still running, and the same request succeeds once it confirms) or `unverified` (the move gave up without confirming, so where the message sits is unknown until the folder is resynced).
  """)
model MessagePlacementConflict {
  @statusCode statusCode: 409;
  ...ApiError;
}

@doc("""
  The same flat 409 body, with the two codes this endpoint can answer with.
  
  `code: "folder_role_unresolved"` — as everywhere else, with `details` carrying `role`, `accountId` and `reason`.
  
  `code: "message_placement_unsettled"` — as `MessagePlacementConflict`, with `details` carrying `accountId`, `messageId` and `reason`.
  """)
model DeleteMessagesConflict is FolderRoleConflict;
