import "typespec-electrodb-emitter";
import "@typespec/http";

import "../enums/AccountExportState.tsp";
import "../scalars/string.tsp";

using TypeSpec.Http;

namespace RemitImap;

@doc("An async request to export all of a user's email data as a ZIP archive of .eml files")
@entity("accountExportRequest", "remit")
@index(
  "AccountExportRequest",
  {
    pk: [AccountExportRequest.accountExportRequestId],
    sk: [],
  }
)
@index(
  "byAccountConfigId",
  {
    index: "gsi0",
    pk: [AccountExportRequest.accountConfigId],
    sk: [AccountExportRequest.createdAt],
  }
)
model AccountExportRequest {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  accountExportRequestId: UUID;

  @doc("Owning account config")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Cognito user id of the requesting user")
  @visibility(Lifecycle.Read)
  userId: string;

  @doc("Current lifecycle state of the export")
  @visibility(Lifecycle.Read)
  state: AccountExportState = AccountExportState.Pending;

  @doc("Epoch millis when the request was created")
  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @doc("Epoch millis when the request was last updated")
  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;

  @doc("Epoch millis after which the stored archive is reclaimed by its lifecycle policy")
  @visibility(Lifecycle.Read)
  expiresAt?: int64;

  @doc("S3 object key of the ZIP archive; present only when state is Ready. The download URL is signed on demand at read time and never stored.")
  @visibility(Lifecycle.Read)
  objectKey?: string;

  @doc("Short-lived presigned S3 URL to download the ZIP archive, signed on demand at read time; present only when state is Ready")
  @visibility(Lifecycle.Read)
  downloadUrl?: string;

  @doc("Human-readable error message; present only when state is Failed")
  @visibility(Lifecycle.Read)
  errorMessage?: string;
}

@doc("Response body for POST /me/export")
model CreateExportResponse {
  @statusCode statusCode: 202;

  @doc("ID of the newly created export request")
  exportId: string;
}

@doc("Response body for GET /me/export/{exportId}")
model AccountExportRequestResponse
  is PickProperties<
    AccountExportRequest,

      | "accountExportRequestId"
      | "accountConfigId"
      | "userId"
      | "state"
      | "createdAt"
      | "updatedAt"
      | "expiresAt"
      | "objectKey"
      | "downloadUrl"
      | "errorMessage"
  >;
