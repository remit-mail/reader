namespace RemitImap;

@doc("Where a calendar collection came from. `Default` is the one provisioned per account config on first use and is never deleted; `UserCreated` is one a person made; `MailDerived` is one populated from mail rather than by a person.")
enum CalendarSource {
  Default: "Default",
  UserCreated: "UserCreated",
  MailDerived: "MailDerived",
}
