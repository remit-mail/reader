import "@typespec/http";
import "../enums/PeopleErrorCode.tsp";

using TypeSpec.Http;

namespace RemitImap;

@doc("Whether a person may sign in. A disabled person's sessions, MCP grants and calendar feeds are revoked, and every sign-in is refused.")
enum PersonStatus {
  Active,
  Disabled,
}

@doc("One person who signs in to this self-hosted instance.")
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

@doc("The operation a step-up token is spent on. `updatePerson` maps `Disabled` to `Disable` and `Active` to `Enable`.")
enum StepUpAction {
  SignOut,
  Disable,
  Enable,
  ResetPassword,
}

@doc("The caller's current password, and the one action on one person the token will allow.")
model StepUpInput {
  @doc("The caller's own current password.")
  password: string;

  action: StepUpAction;

  @doc("The person the token will act on.")
  userId: string;
}

@doc("A single-use token for one action on one person. Spend it at once; it is never stored by the client.")
model StepUpResponse {
  stepUpToken: string;

  @doc("When the token stops working, epoch milliseconds.")
  expiresAt: int64;
}

@doc("Sign the person out of every browser session and MCP connection.")
model SignOutPersonInput {
  stepUpToken: string;
}

@doc("Disable or enable the person. Disabling also revokes their sessions, MCP grants and calendar feeds.")
model UpdatePersonInput {
  status: PersonStatus;
  stepUpToken: string;
}

@doc("Issue a password reset link for the person. Their old password stops working and their sessions are revoked.")
model CreatePasswordResetInput {
  stepUpToken: string;
}

@doc("The person, and the reset link to hand them. The link is shown once and works once.")
model PasswordResetResponse {
  person: Person;

  @doc("The single-use reset link. It exists only in this response.")
  resetUrl: string;

  @doc("When the link stops working, epoch milliseconds: issue time plus 24 hours.")
  expiresAt: int64;
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
    | PeopleErrorCode.WrongPassword;
}

@doc("Too many wrong step-up passwords.")
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
