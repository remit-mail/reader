import { verifyStoragePath } from "./signed-path.js";

/**
 * The self-hosted half of the upload seam: what a minted URL looks like when
 * there is no block storage to presign against, and how the route that receives
 * the bytes decides to accept them.
 *
 * A hosted deployment mints a presigned PUT instead and none of this runs — the
 * bytes never reach the deployment at all. Both halves bind the same two
 * things, an expiry and an exact byte count, so a client sees one contract.
 */

/** Domain separation: a read grant must never be presentable as a write grant. */
export const UPLOAD_URL_SIGNING_LABEL = "remit-outbox-upload-url-signing-v1";

export const UPLOAD_ROUTE_PREFIX = "/outbox-upload/";

/**
 * How long a mint's URL, and the reservation behind it, stay good. Long enough
 * for a slow phone to push 25 MB, short enough that a draft abandoned mid-upload
 * stops holding room within the same session.
 */
export const UPLOAD_URL_TTL_SECONDS = 900;

export interface AuthorizeUploadInput {
	secret: string | undefined;
	/** Decoded storage key the signature was minted over. */
	relativePath: string;
	exp: string | undefined;
	max: string | undefined;
	sig: string | undefined;
	nowSeconds: number;
}

export type AuthorizeUploadResult =
	| { authorized: true; maxBytes: number }
	| { authorized: false; status: number; reason: string };

/**
 * Decide whether an upload request may write to the key it names.
 *
 * Pure, so the decision is testable without a live server. Mirrors
 * `authorizeContentRequest` on the read side, with one addition: the byte count
 * is part of the signed message, so the caller learns from the signature how
 * much this URL is allowed to carry and can cut the stream off there.
 */
export const authorizeUploadRequest = (
	input: AuthorizeUploadInput,
): AuthorizeUploadResult => {
	if (!input.secret || input.secret.length === 0) {
		// No secret means no upload URL could have been signed, so nothing
		// presented here can be trusted. Fail closed.
		return {
			authorized: false,
			status: 500,
			reason: "upload-signing-not-configured",
		};
	}

	const exp = Number(input.exp);
	const maxBytes = Number(input.max);
	if (!Number.isInteger(exp) || !Number.isInteger(maxBytes)) {
		return { authorized: false, status: 403, reason: "malformed" };
	}

	const result = verifyStoragePath(
		input.secret,
		UPLOAD_URL_SIGNING_LABEL,
		input.relativePath,
		[exp, maxBytes],
		input.sig,
		input.nowSeconds,
	);
	if (result.valid) return { authorized: true, maxBytes };

	const status = result.reason === "missing" ? 401 : 403;
	return { authorized: false, status, reason: result.reason };
};
