import "../enums/NamespaceType.tsp";

@doc("Represents IMAP namespaces as defined in RFC 9051 Section 6.3.10. Each account can have personal, other users', and shared namespaces.")
model Namespace {
  @doc("Primary identifier")
  namespaceId: string;

  @doc("Reference to the owning account")
  accountId: string;

  @doc("Namespace type: personal, other_users, or shared")
  namespaceType: NamespaceType;

  @doc("Namespace prefix (e.g., '', '~', '#shared/')")
  prefix: string;

  @doc("Character used to separate hierarchy levels (typically '/' or '.')")
  @minLength(1)
  @maxLength(1)
  hierarchyDelimiter: string;

  @doc("Sort order for namespace listing")
  @minValue(0)
  sortOrder: int32;
}
