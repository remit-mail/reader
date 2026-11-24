import "@typespec/http";
import "../enums/PeopleErrorCode.tsp";

using TypeSpec.Http;

namespace RemitImap;

@doc("Whether a person may sign in. A disabled person's sessions, MCP grants and calendar feeds are revoked, and every sign-in is refused.")
enum PersonStatus {
  Active,
  Disabled,
}

@doc("One person who signs in to this instance.")
model Person {
  @doc("The person's user id.")
  userId: string;

  @doc("The address the person signs in with.")
  email: string;

  @doc("When the account was created, epoch milliseconds.")
  createdAt: int64;

  @doc("When the person last signed in, epoch milliseconds.")
  lastSignInAt: int64;

  @doc("Unexpired browser sessions the person holds.")
  sessionCount: int32;

  @doc("Whether the person may sign in.")
  status: PersonStatus;

  @doc("Whether this row is the caller.")
  isCaller: boolean;
}

@doc("Everyone who signs in to this instance, ordered by email.")
model PeopleListResponse {
  people: Person[];
}

@doc("The action identified by the legacy password check; People actions do not require a grant. `updatePerson` maps `Disabled` to `Disable` and `Active` to `Enable`.")
enum StepUpAction {
  SignOut,
  Disable,
  Enable,
  ResetPassword,
}

@doc("The caller's current password and the action and person identified by the legacy password check.")
model StepUpInput {
  @doc("The caller's own current password.")
  password: string;

  action: StepUpAction;

  @doc("The person identified by the legacy password check.")
  userId: string;
}

@doc("Legacy password-check response kept for compatibility and ignored by People actions.")
model StepUpResponse {
  @doc("Legacy token kept for compatibility and ignored by People actions.")
  stepUpToken: string;

  @doc("Legacy expiry timestamp in epoch milliseconds; ignored by People actions.")
  expiresAt: int64;
}

@doc("Disable or enable the person. Disabling also revokes their sessions, MCP grants and calendar feeds.")
model UpdatePersonInput {
  status: PersonStatus;
}

@doc("The person, and the reset link to hand them. The link is shown once and works once.")
model PasswordResetResponse {
  person: Person;

  @doc("The single-use reset link. It exists only in this response.")
  resetUrl: string;

  @doc("When the link stops working, epoch milliseconds: issue time plus 24 hours.")
  expiresAt: int64;
}

@doc("Invite one email address to create an account.")
model InvitePersonInput {
  email: string;
}

@doc("The email address whose invite was issued or revoked.")
model PersonInviteResponse {
  email: string;
}

@doc("One retained People audit event.")
model PeopleAuditEvent {
  auditEventId: string;
  occurredAt: int64;
  actor: string;
  target: string;
  action: string;
  outcome: string;
  clientIp: string;
}

@doc("Retained People audit events, newest first.")
model PeopleAuditResponse {
  events: PeopleAuditEvent[];
}

@doc("The People operation is refused for the caller.")
model PeopleForbiddenError {
  @statusCode statusCode: 403;
  ...OmitProperties<ApiError, "code">;
  code:
    | PeopleErrorCode.SignInDisabled
    | PeopleErrorCode.CallerDisabled
    | PeopleErrorCode.ForeignOrigin
    | PeopleErrorCode.StepUpRequired
    | PeopleErrorCode.WrongPassword
    | "forbidden";
}

@doc("Too many wrong passwords in legacy password checks.")
model StepUpLockedError {
  @statusCode statusCode: 429;
  ...OmitProperties<ApiError, "code">;
  code: PeopleErrorCode.StepUpLocked;
}

@doc("The caller tried to disable their own account.")
model CannotDisableSelfError {
  @statusCode statusCode: 409;
  ...OmitProperties<ApiError, "code">;
  code: PeopleErrorCode.CannotDisableSelf;
}
