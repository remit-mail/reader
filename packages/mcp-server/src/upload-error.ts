// Only server-defined reason codes travel back to the caller. Storage error
// bodies can also contain signed URLs, signatures, and other credentials.
const REASONS: Readonly<Record<string, string>> = {
	"not-an-attachment-key": "The upload URL does not name an attachment",
	"upload-signing-not-configured":
		"Attachment upload signing is not configured",
	missing: "The upload URL is missing its signature",
	malformed: "The upload URL is malformed",
	expired: "The upload URL has expired",
	"bad-signature": "The upload URL signature is invalid",
	"no-live-reservation": "The attachment has no live upload reservation",
	"over-reserved-size": "The attachment exceeds its reserved size",
	"size-mismatch": "The attachment size does not match its reservation",
	AccessDenied: "Storage denied access to the attachment upload",
	ExpiredToken: "The storage upload token has expired",
	RequestExpired: "The upload URL has expired",
	SignatureDoesNotMatch: "The upload URL signature is invalid",
	EntityTooLarge: "The attachment exceeds the storage size limit",
	InvalidAccessKeyId: "The storage access key is invalid",
	InvalidToken: "The storage upload token is invalid",
};

export const attachmentUploadFailure = async (
	response: Response,
): Promise<string> => {
	const body = await response.text();
	const code =
		response.headers.get("x-remit-upload-reason") ??
		/<Code>([^<]+)<\/Code>/.exec(body)?.[1] ??
		body.trim();
	const reason = Object.hasOwn(REASONS, code)
		? REASONS[code]
		: "The storage server refused the upload";
	return `Attachment upload failed with status ${response.status}: ${reason}`;
};
