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
}
