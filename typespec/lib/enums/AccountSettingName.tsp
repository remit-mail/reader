namespace RemitImap;

@doc("Known user-setting keys. Each maps, in the registry, to a required value kind and a zod schema. New keys are added deliberately by extending this enum and the registry — never as an ad-hoc column.")
enum AccountSettingName {
  @doc("UI theme choice (e.g. light / dark / system)")
  Theme,

  @doc("UI density (e.g. comfortable / compact)")
  Density,

  @doc("Default body format for the composer (e.g. html / plaintext)")
  DefaultComposerFormat,

  @doc("Ordered list of folder paths the user pinned")
  PinnedFolders,

  @doc("Plain-text email signature for a single account. Stored per-account: the persisted name is composed as `AccountSignaturePlainText#<accountId>`, so one account configuration can hold a distinct signature per account.")
  AccountSignaturePlainText,

  @doc("HTML email signature for a single account. Stored per-account: the persisted name is composed as `AccountSignatureHtml#<accountId>`, so one account configuration can hold a distinct signature per account.")
  AccountSignatureHtml,

  @doc("User-chosen display name for a single account. Stored per-account: the persisted name is composed as `AccountDisplayName#<accountId>`. String-valued.")
  AccountDisplayName,

  @doc("Account-level mute flag for a single account. Stored per-account: the persisted name is composed as `AccountMuted#<accountId>`. MutedFlag-valued (a rich object).")
  AccountMuted,

  @doc("The BCP 47 language tags a single account writes mail in, most-used first (issue #686). Stored per-account: the persisted name is composed as `AccountComposeLanguages#<accountId>`. StringList-valued. The first entry is the language a new message opens on; the whole list is the candidate set language detection chooses inside, and the menu the composer's language chip offers.")
  AccountComposeLanguages,

  @doc("User-chosen sidebar label for a single mailbox. Stored per-mailbox: the persisted name is composed as `MailboxDisplayName#<mailboxId>`. String-valued.")
  MailboxDisplayName,

  @doc("Mailbox-level mute flag for a single mailbox. Stored per-mailbox: the persisted name is composed as `MailboxMuted#<mailboxId>`. MutedFlag-valued (a rich object).")
  MailboxMuted,

  @doc("Per-account appointment of a canonical role to a mailbox (RFC 032 exclusive-folder-appointment, issue #976). Stored per-(account, role): the persisted name is composed as `FolderRoleAppointment#<accountId>#<role>`. String-valued (a mailboxId).")
  FolderRoleAppointment,

  @doc("The path the appointed mailbox had when the user appointed it, so a folder that later vanishes can still be named back to them (issue #887). Stored per-(account, role): the persisted name is composed as `FolderRoleAppointmentLabel#<accountId>#<role>`. String-valued. Display only — role resolution never reads it, and it is a sibling row rather than a field on the appointment so that guarantee is structural.")
  FolderRoleAppointmentLabel,

  @doc("Deprecated tombstone: superseded by `FolderRoleAppointment` (RFC 032 exclusive-folder-appointment, issue #976). Retained only so `baseSettingName` recognises leftover `MailboxRole#<mailboxId>` rows written by the #963/#964 backfill instead of throwing; readers ignore this base. Do not write new rows under this name. Remove once the row-deletion migration ships.")
  MailboxRole,
}
