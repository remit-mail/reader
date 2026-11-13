import "typespec-electrodb-emitter";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("The registry published a registration date.")
model DomainRegistrationPublished {
  state: "Published";

  @doc("ISO 8601 date-time with offset, as the registry's RDAP `registration` event states it.")
  registeredAt: string;
}

@doc("The registry answered and published no registration date, as DENIC does for .de.")
model DomainRegistrationUnpublished {
  state: "Unpublished";
}

@doc("What a registry's RDAP answer said about a domain's registration.")
union DomainRegistrationOutcome {
  published: DomainRegistrationPublished,
  unpublished: DomainRegistrationUnpublished,
}

@doc("A successful RDAP answer for one registrable domain, cached because a registration date never changes (RFC 041). A failed lookup is never cached.")
@entity("domainRegistration", "remit")
@index(
  "DomainRegistration",
  {
    pk: [DomainRegistration.domainRegistrationId],
    sk: [],
  }
)
model DomainRegistration {
  @doc("The registrable domain (eTLD+1), lowercased. It is the row's identity: one row per domain.")
  @visibility(Lifecycle.Read)
  domainRegistrationId: String256;

  @visibility(Lifecycle.Read)
  registration: DomainRegistrationOutcome;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
