import { verifyContentSignature } from "../src/derive/contentSignature.js";

/**
 * Decide whether a `/content` request is authorized. Enforcement applies on the
 * self-host SQL backends (postgres and sqlite), where this server is the
 * deployed backend container and content URLs are signed. On AWS-local dev
 * (`DATA_BACKEND` unset) `/content` is served straight from the filesystem
 * stand-in for CloudFront and URLs are unsigned, so the check is a no-op.
 *
 * Pure so the decision can be unit-tested without a live server. `relativePath`
 * is the decoded storage path (`accounts/{cfg}/{acc}/messages/{msg}/parts/{part}`)
 * the signature was minted over — the caller strips the `/content/` prefix.
 */
export interface AuthorizeContentInput {
	dataBackend: string | undefined;
	secret: string | undefined;
	relativePath: string;
	exp: string | undefined;
	sig: string | undefined;
	nowSeconds: number;
}

export const authorizeContentRequest = (
	input: AuthorizeContentInput,
):
	| { authorized: true }
	| { authorized: false; status: number; reason: string } => {
	if (input.dataBackend !== "postgres" && input.dataBackend !== "sqlite") {
		return { authorized: true };
	}

	if (!input.secret || input.secret.length === 0) {
		// A self-host SQL backend with no signing secret means every content URL
		// is unsigned and unverifiable. Fail closed rather than serve mail bytes
		// without auth.
		return {
			authorized: false,
			status: 500,
			reason: "content-signing-not-configured",
		};
	}

	const result = verifyContentSignature(
		input.relativePath,
		input.exp,
		input.sig,
		input.secret,
		input.nowSeconds,
	);
	if (result.valid) return { authorized: true };

	const status = result.reason === "missing" ? 401 : 403;
	return { authorized: false, status, reason: result.reason };
};
