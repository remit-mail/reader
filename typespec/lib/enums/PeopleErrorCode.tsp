namespace RemitImap;

@doc("Why a People operation was refused. Wire values stay snake_case.")
enum PeopleErrorCode {
  @doc("The kill switch is on.")
  SignInDisabled: "sign_in_disabled",

  @doc("The caller's account is disabled or gone.")
  CallerDisabled: "caller_disabled",

  @doc("An unsafe request from an origin this instance does not serve.")
  ForeignOrigin: "foreign_origin",

  @doc("The step-up token is missing, spent, expired, or bound to another caller, action or person.")
  StepUpRequired: "step_up_required",

  @doc("The step-up password is wrong.")
  WrongPassword: "wrong_password",

  @doc("Five wrong step-up passwords in 15 minutes.")
  StepUpLocked: "step_up_locked",

  @doc("A person cannot disable themselves.")
  CannotDisableSelf: "cannot_disable_self",
}
