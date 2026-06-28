namespace RemitImap;

@doc("""
  Mailbox special-use designations, named after RFC 6154 / RFC 9051 Section 7.3.1.
  Values are the BARE forms (no leading backslash): Remit stores and serves
  `"Junk"`, not the RFC's `"\\Junk"`. The runtime is bare across the generated
  enums and ElectroDB entities, and a backslash-prefixed value can't survive the
  current enum emitter anyway, so the wire contract uses the bare form.
  """)
enum MailboxSpecialUse {
  @doc("All messages (virtual folder)")
  All: "All",

  @doc("Archived messages")
  Archive: "Archive",

  @doc("Draft messages")
  Drafts: "Drafts",

  @doc("Flagged/starred messages")
  Flagged: "Flagged",

  @doc("Junk/spam messages")
  Junk: "Junk",

  @doc("Sent messages")
  Sent: "Sent",

  @doc("Deleted/trash messages")
  Trash: "Trash",

  @doc("Important messages")
  Important: "Important",
}
