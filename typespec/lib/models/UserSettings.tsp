import "@typespec/http";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  The caller's own settings: choices that belong to the person rather than to
  one mail account. Each field is stored as an `AccountSetting` row of the
  account config and read back here, so a setting added later is one more
  field on this resource rather than one more operation.
  """)
model UserSettingsResponse {
  @doc("The account calendar invitations, updates and cancellations go out from unless the event editor picks another: the one the reader chose while it still sends mail, otherwise the account an event is on — for a new event, the first account of the account config that sends mail, since a calendar belongs to the account config rather than to one account. Absent only when no account sends mail.")
  defaultInvitationSenderAccountId?: UUID;

  @doc("Whether `defaultInvitationSenderAccountId` is the reader's own choice rather than the account an event is on.")
  defaultInvitationSenderChosen: boolean;
}

@doc("A change to the caller's settings. Every field is optional and absence means untouched.")
model UpdateUserSettingsInput {
  @doc("The account invitations go out from by default. Refused with 400 `unknown_sender` when it is not an account of the caller's account config that sends mail. Cleared with `clearDefaultInvitationSender`.")
  defaultInvitationSenderAccountId?: UUID;
}
