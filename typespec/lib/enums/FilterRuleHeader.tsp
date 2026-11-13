namespace RemitImap;

@doc("The header a FilterRule header test reads (RFC 040). `ListId` is normalized as a `List-Id` filter clause is.")
enum FilterRuleHeader {
  From: "From",
  Subject: "Subject",
  ListId: "ListId",
}
