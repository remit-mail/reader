import "typespec-electrodb-emitter";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  The secret address a calendar is subscribed to from outside (issue #1067).
  
  A subscriber never signs in: Apple Calendar, Google Calendar and Thunderbird
  poll a URL and send no credential, so the URL is the credential. Only the
  SHA-256 hash of the token is stored — the plaintext is handed out once, at the
  write that mints it, and a caller that loses it rotates rather than reads it
  back.
  
  `feedTokenId` is derived from `calendarId`, so one calendar holds one active
  token by construction: rotating rewrites the row it already has, and the
  previous address stops resolving the moment the new hash lands. A second
  active address per calendar would be a credential nobody could see to revoke.
  
  The hash is a plain digest and deliberately not a slow one. The token carries
  32 random bytes, so there is nothing to brute-force and no password-equivalent
  to stretch; a KDF here would only make every poll from every subscribed client
  expensive.
  """)
@entity("calendarFeedToken", "remit")
@index(
  "CalendarFeedToken",
  {
    pk: [CalendarFeedToken.accountConfigId],
    sk: [CalendarFeedToken.feedTokenId],
  }
)
// The feed read, which holds the token and nothing else. It arrives with no
// session, so it cannot be scoped by account config the way every management
// read is — the hash is the whole lookup key, and the row it finds names the
// calendar and its owner.
@index(
  "byTokenHash",
  {
    index: "gsi0",
    pk: [CalendarFeedToken.tokenHash],
    sk: [],
  }
)
model CalendarFeedToken {
  @doc("Primary identifier, derived from calendarId")
  @visibility(Lifecycle.Read)
  feedTokenId: UUID;

  @doc("Owning account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Collection this address serves")
  @visibility(Lifecycle.Read)
  calendarId: UUID;

  @doc("SHA-256 of the token, lower-case hex. The plaintext is never stored: a leaked database gives a reader no working subscription URL.")
  @visibility(Lifecycle.Read)
  tokenHash: String64;

  @doc("When this calendar first got a feed address. Survives a rotation — the feed is the same feed, under a new secret.")
  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @doc("When the token was last replaced. `0` means it is still the one this calendar started with.")
  @visibility(Lifecycle.Read)
  rotatedAt: int64 = 0;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
