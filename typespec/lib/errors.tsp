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
