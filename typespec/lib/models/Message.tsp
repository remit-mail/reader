import "../enums/MessageFlag.tsp";

namespace RemitImap;

@doc("Core message entity. The combination of Mailbox.uidValidity + Message.uid uniquely identifies a message forever per RFC 9051 Section 2.3.1.1.")
model Message {
  @doc("Primary identifier (internal UUID)")
  messageId: string;

  @doc("Reference to parent mailbox")
  mailboxId: string;

  @doc("IMAP UID - unique within mailbox, strictly ascending, never reused under same UIDVALIDITY")
  @minValue(1)
  uid: int64;

  @doc("Relative position (1-based), changes on EXPUNGE")
  @minValue(1)
  sequenceNumber: int32;

  @doc("Message size in octets in RFC 5322 format")
  @minValue(0)
  rfc822Size: int64;

  @doc("Server receipt timestamp (INTERNALDATE)")
  internalDate: utcDateTime;

  @doc("Message-ID header value for quick reference")
  messageIdHeader?: string;

  @doc("Reference to parsed envelope data")
  envelopeId: string;

  @doc("Reference to root body part for BODYSTRUCTURE")
  rootBodyPartId: string;

  @doc("Record creation timestamp")
  createdAt: utcDateTime;

  @doc("Record update timestamp")
  updatedAt: utcDateTime;
}

@doc("Message flags as defined in RFC 9051 Section 2.3.2")
model MessageFlag {
  @doc("Primary identifier")
  messageFlagId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Flag value: system flag, common keyword, or custom keyword")
  flagName: MessageFlagValue;

  @doc("When the flag was set")
  setAt: utcDateTime;
}
