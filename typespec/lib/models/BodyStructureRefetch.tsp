import "typespec-electrodb-emitter";

namespace RemitImap;

@doc("""
  A message whose body part rows a repair dropped because they were stored
  wrong, queued for message sync to read its BODYSTRUCTURE again from the mail
  server. Message sync drains the queue once per message: the row goes when
  the message is saved again or the server no longer holds it, whatever parts
  came back.
  """)
@entity("bodyStructureRefetch", "remit")
@index(
  "BodyStructureRefetch",
  {
    pk: [BodyStructureRefetch.messageId],
    sk: [],
  }
)
model BodyStructureRefetch {
  @doc("The message whose structure is to be read again.")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
