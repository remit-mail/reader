namespace RemitImap;

@doc("Groups trace header fields (Return-Path and Received headers) that are prepended to messages during transport per RFC 2822 Section 3.6.7.")
model TraceBlock {
  @doc("Primary identifier")
  traceBlockId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Order of trace blocks (0 = most recent, prepended during transport)")
  @minValue(0)
  blockOrder: int32;
}

@doc("The Return-Path header field per RFC 2822 Section 3.6.7. Contains the envelope sender address added by the final delivery agent.")
model ReturnPath {
  @doc("Primary identifier")
  returnPathId: string;

  @doc("Reference to parent trace block")
  traceBlockId: string;

  @doc("Return path address (may be empty string for null reverse-path/bounce)")
  addrSpec: string;
}

@doc("Received header field per RFC 2822 Section 3.6.7. Records each hop in the message transport path.")
model ReceivedField {
  @doc("Primary identifier")
  receivedFieldId: string;

  @doc("Reference to parent trace block")
  traceBlockId: string;

  @doc("Order within trace block (0 = first Received header)")
  @minValue(0)
  receivedOrder: int32;

  @doc("Complete Received header value for preservation")
  rawValue: string;

  @doc("Sending host from 'from' clause")
  fromDomain?: string;

  @doc("Receiving host from 'by' clause")
  byDomain?: string;

  @doc("Intended recipient from 'for' clause")
  forAddress?: string;

  @doc("Protocol from 'with' clause (SMTP, ESMTP, ESMTPS, etc.)")
  withProtocol?: string;

  @doc("Queue ID from 'id' clause")
  id?: string;

  @doc("Link type from 'via' clause")
  via?: string;

  @doc("Timestamp from the Received header (after semicolon)")
  receivedDate: utcDateTime;
}
