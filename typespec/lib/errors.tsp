import "@typespec/http";

using TypeSpec.Http;

@doc("API error response")
model ApiError {
  @doc("Error code")
  code: string;

  @doc("Human-readable error message")
  message: string;

  @doc("Additional error details")
  details?: Record<string>;
}

@doc("Not found error response")
model NotFoundError {
  @statusCode statusCode: 404;
  @body error: ApiError;
}

@doc("Validation error response")
model ValidationError {
  @statusCode statusCode: 400;
  @body error: ApiError;
}

@doc("""
  The condition the request stated is no longer true. Answered when an
  `If-Match` names an etag the stored resource no longer carries: somebody else
  wrote it in between, so applying this request would silently discard their
  change. The client re-reads the resource and decides what to do with the
  version it now has.
  """)
model PreconditionFailedError {
  @statusCode statusCode: 412;
  @body error: ApiError;
}

@doc("Internal server error response")
model InternalServerError {
  @statusCode statusCode: 500;
  @body error: ApiError;
}

@doc("Unauthorized error response")
model UnauthorizedError {
  @statusCode statusCode: 401;
  @body error: ApiError;
}

@doc("Forbidden error response")
model ForbiddenError {
  @statusCode statusCode: 403;
  @body error: ApiError;
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
  The same flat 409 body as `FolderRoleConflict`, with one code only this endpoint can answer with.
  
  `code: "folder_role_unresolved"` — as everywhere else, with `details` carrying `role`, `accountId` and `reason`.
  
  `code: "mailbox_not_settled"` — the mailbox being appointed is still being created or deleted on the mail server, so it cannot yet hold a role. `details` carries `mailboxId` and `syncStatus`. Clearing a role is never refused this way.
  """)
model AppointFolderRoleConflict is FolderRoleConflict;

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
