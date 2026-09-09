namespace RemitImap;

@doc("Header-derived message category. Set by classifyByHeaders during body-sync. Defaults to `uncategorized`, which covers both a message that has not been classified yet and one the classifier declined to categorize; `Message.classificationState` is what tells those apart.")
enum MessageCategory {
  @doc("No category. The default, never inferred from absence — and never a stand-in for `personal`. It is the value a metadata-synced message starts at AND the answer the classifier gives when it has nothing to say, so it does not on its own mean \"not classified yet\": `Message.classificationState` carries that.")
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
