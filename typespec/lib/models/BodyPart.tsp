import "../enums/MediaType.tsp";
import "../enums/TransferEncoding.tsp";
import "../enums/ContentDisposition.tsp";
import "../enums/MultipartSubtype.tsp";

@doc("Represents MIME body structure (RFC 9051 Section 2.3.6, Section 7.5.2). Supports recursive nesting for multipart messages.")
model BodyPart {
  @doc("Primary identifier")
  bodyPartId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Reference to parent body part for nested multipart (null for root)")
  parentBodyPartId?: string;

  @doc("IMAP section path (e.g., '1', '1.2', '2.1.3')")
  @minLength(1)
  partPath: string;

  @doc("MIME type (TEXT, IMAGE, APPLICATION, etc.)")
  mediaType: MediaType;

  @doc("MIME subtype (PLAIN, HTML, PNG, PDF, etc.)")
  @minLength(1)
  mediaSubtype: string;

  @doc("Content-ID header value")
  contentId?: string;

  @doc("Content-Description header value")
  contentDescription?: string;

  @doc("Transfer encoding (7BIT, 8BIT, BASE64, QUOTED-PRINTABLE, BINARY)")
  transferEncoding: TransferEncoding;

  @doc("Encoded size in octets")
  @minValue(0)
  sizeOctets: int64;

  @doc("Line count for TEXT types (required by IMAP BODYSTRUCTURE)")
  lineCount?: int32;

  @doc("Body MD5 hash")
  md5Hash?: string;

  @doc("Content disposition (inline or attachment)")
  disposition?: ContentDisposition;

  @doc("Filename from Content-Disposition")
  dispositionFilename?: string;

  @doc("Content-Language header value")
  language?: string;

  @doc("Content-Location URI")
  location?: string;

  @doc("True if this is a multipart container")
  isMultipart: boolean;

  @doc("For multipart: subtype (mixed, alternative, related, etc.)")
  multipartSubtype?: MultipartSubtype;
}

@doc("Content-Type and other MIME parameters (CHARSET, BOUNDARY, NAME, etc.)")
model BodyPartParameter {
  @doc("Primary identifier")
  bodyPartParameterId: string;

  @doc("Reference to parent body part")
  bodyPartId: string;

  @doc("Parameter name (e.g., 'CHARSET', 'NAME', 'BOUNDARY')")
  @minLength(1)
  parameterName: string;

  @doc("Parameter value")
  parameterValue: string;
}
