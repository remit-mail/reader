import "typespec-electrodb-emitter";

import "../enums/MediaType.tsp";
import "../enums/TransferEncoding.tsp";
import "../enums/ContentDisposition.tsp";
import "../enums/MultipartSubtype.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Represents MIME body structure (RFC 9051 Section 2.3.6, Section 7.5.2). Supports recursive nesting for multipart messages.")
@entity("bodyPart", "remit")
@index(
  "BodyPart",
  {
    pk: [BodyPart.bodyPartId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [BodyPart.messageId],
    sk: [BodyPart.bodyPartId],
  }
)
model BodyPart {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  bodyPartId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent body part for nested multipart (null for root)")
  @visibility(Lifecycle.Read)
  parentBodyPartId?: UUID;

  @doc("IMAP section path (e.g., '1', '1.2', '2.1.3')")
  @visibility(Lifecycle.Read)
  @minLength(1)
  partPath: string;

  @doc("MIME type (TEXT, IMAGE, APPLICATION, etc.)")
  @visibility(Lifecycle.Read)
  mediaType: MediaType;

  @doc("MIME subtype (PLAIN, HTML, PNG, PDF, etc.)")
  @visibility(Lifecycle.Read)
  @minLength(1)
  mediaSubtype: string;

  @doc("Content-ID header value")
  @visibility(Lifecycle.Read)
  contentId?: string;

  @doc("Content-Description header value")
  @visibility(Lifecycle.Read)
  contentDescription?: string;

  @doc("Transfer encoding (7BIT, 8BIT, BASE64, QUOTED-PRINTABLE, BINARY)")
  @visibility(Lifecycle.Read)
  transferEncoding: TransferEncoding;

  @doc("Encoded size in octets")
  @visibility(Lifecycle.Read)
  @minValue(0)
  sizeOctets: int64;

  @doc("Line count for TEXT types (required by IMAP BODYSTRUCTURE)")
  @visibility(Lifecycle.Read)
  lineCount?: int32;

  @doc("Body MD5 hash")
  @visibility(Lifecycle.Read)
  md5Hash?: string;

  @doc("Content disposition (inline or attachment)")
  @visibility(Lifecycle.Read)
  disposition?: ContentDisposition;

  @doc("Filename from Content-Disposition")
  @visibility(Lifecycle.Read)
  dispositionFilename?: string;

  @doc("Content-Language header value")
  @visibility(Lifecycle.Read)
  language?: string;

  @doc("Content-Location URI")
  @visibility(Lifecycle.Read)
  location?: string;

  @doc("True if this is a multipart container")
  @visibility(Lifecycle.Read)
  isMultipart: boolean;

  @doc("For multipart: subtype (mixed, alternative, related, etc.)")
  @visibility(Lifecycle.Read)
  multipartSubtype?: MultipartSubtype;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Content-Type and other MIME parameters (CHARSET, BOUNDARY, NAME, etc.)")
@entity("bodyPartParameter", "remit")
@index(
  "BodyPartParameter",
  {
    pk: [BodyPartParameter.bodyPartParameterId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [BodyPartParameter.messageId],
    sk: [BodyPartParameter.bodyPartParameterId],
  }
)
model BodyPartParameter {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  bodyPartParameterId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent body part")
  @visibility(Lifecycle.Read)
  bodyPartId: UUID;

  @doc("Parameter name (e.g., 'CHARSET', 'NAME', 'BOUNDARY')")
  @visibility(Lifecycle.Read)
  @minLength(1)
  parameterName: string;

  @doc("Parameter value")
  @visibility(Lifecycle.Read)
  parameterValue: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

// ============================================
// API Response Models
// ============================================

@doc("Body part information")
model BodyPartResponse {
  ...PickProperties<
    BodyPart,

      | "bodyPartId"
      | "mediaType"
      | "mediaSubtype"
      | "disposition"
      | "dispositionFilename"
      | "sizeOctets"
      | "isMultipart"
      | "contentId"
  >;

  @doc("CloudFront-fronted URL for fetching this body part. Cookie-authenticated via Cognito id_token. Path: /content/accounts/{accountConfigId}/{accountId}/messages/{messageId}/parts/{partPath}. Required: handlers must throw rather than emit a placeholder when CONTENT_DELIVERY_DOMAIN is unset.")
  contentUrl: url;
}
