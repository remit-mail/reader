namespace RemitImap;

@doc("Header-derived message category. Set by classifyByHeaders during body-sync. Defaults to `uncategorized` until the message is body-classified.")
enum MessageCategory {
  @doc("Not yet classified — the message has been metadata-synced but not yet body-classified. The default, never inferred from absence.")
  uncategorized: "uncategorized",

  @doc("Person-to-person mail (default fallback)")
  personal: "personal",

  @doc("Mailing-list newsletter (List-Id + List-Unsubscribe present)")
  newsletter: "newsletter",

  @doc("Bulk marketing mail (List-Unsubscribe present, no List-Id)")
  marketing: "marketing",

  @doc("Auto-generated mail (Auto-Submitted, Precedence: bulk/list/junk, DKIM-mismatched relay)")
  automated: "automated",

  @doc("Transactional mail (calendar invites, receipts, allow-listed senders)")
  transactional: "transactional",

  @doc("Notification from a known social platform")
  social: "social",
}
