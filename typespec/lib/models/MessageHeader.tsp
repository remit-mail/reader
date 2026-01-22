import "../enums/HeaderFieldName.tsp";

namespace RemitImap;

@doc("Stores all RFC 2822/5322 headers for efficient querying without parsing raw message.")
model MessageHeader {
  @doc("Primary identifier")
  messageHeaderId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Field name: RFC 2822 standard, MIME header, or custom extension")
  headerName: HeaderFieldName;

  @doc("Field body with folding removed (unfolded per RFC 2822 Section 2.2.3)")
  headerValue: string;

  @doc("Original field body preserving CRLF folding for round-tripping")
  headerValueRaw: string;

  @doc("Order of appearance in message (0-indexed), preserves original order")
  @minValue(0)
  headerOrder: int32;
}

@doc("Keywords header field per RFC 2822 Section 3.6.5. Contains comma-separated important words/phrases.")
model MessageKeyword {
  @doc("Primary identifier")
  messageKeywordId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Individual keyword phrase")
  @minLength(1)
  keyword: string;

  @doc("Order within the Keywords header (0-indexed)")
  @minValue(0)
  keywordOrder: int32;
}

@doc("Comments header field per RFC 2822 Section 3.6.5. Contains additional human-readable information about the message body.")
model MessageComment {
  @doc("Primary identifier")
  messageCommentId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Comment text (unstructured)")
  comment: string;

  @doc("Order if multiple Comments headers exist (0-indexed)")
  @minValue(0)
  commentOrder: int32;
}
