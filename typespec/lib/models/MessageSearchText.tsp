import "@kattebak/typespec-drizzle-orm-generator";
import "typespec-electrodb-emitter";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  The body text the search index matches a message by: the plain text with
  quoted replies removed and whitespace collapsed, cut at a word boundary to
  at most 512 KB. Written when the body is stored; the message's snippet
  stays the display preview.
  """)
@entity("messageSearchText", "remit")
@index(
  "MessageSearchText",
  {
    pk: [MessageSearchText.messageId],
    sk: [],
  }
)
model MessageSearchText {
  @doc("The message the text was derived from.")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("The indexed body text; empty when the message has none.")
  @visibility(Lifecycle.Read)
  text: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
