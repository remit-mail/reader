namespace RemitImap;

@doc("Multipart MIME subtypes per RFC 2046")
enum MultipartSubtype {
  @doc("Independent parts in sequence")
  Mixed: "mixed",

  @doc("Alternative representations of same content")
  Alternative: "alternative",

  @doc("Multi-part messages (each part is a complete message)")
  Digest: "digest",

  @doc("Parts intended to be viewed simultaneously")
  Parallel: "parallel",

  @doc("Parts with explicit relationships (e.g., HTML with embedded images)")
  Related: "related",

  @doc("Signed content per RFC 1847")
  Signed: "signed",

  @doc("Encrypted content per RFC 1847")
  Encrypted: "encrypted",

  @doc("Form data submission per RFC 2388")
  FormData: "form-data",

  @doc("Delivery status reports per RFC 3462")
  Report: "report",
}
