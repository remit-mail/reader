import { createHmac, timingSafeEqual } from "node:crypto";
import { usesBetterAuthJwt } from "../data-backend.js";

/**
 * Signed-URL scheme for `/content/*` on the Postgres stack.
 *
 * On AWS the same bytes are guarded by CloudFront + a Lambda@Edge JWT verifier.
 * The Postgres stack serves `/content/*` straight from the backend container,
 * and a bearer token cannot ride along on an `<img src>` / `<a href>` content
 * load rendered inside email HTML. So the backend signs each content URL when
 * it hands the SPA a `BodyPartResponse.contentUrl`, and the `/content` route
 * verifies the signature instead of a bearer.
 *
 * The signature covers the account-scoped storage path (`accounts/{cfg}/{acc}/
 * messages/{msg}/parts/{part}`) plus an expiry. Because the path — including
 * both account ids — is part of the signed message, a signature minted for
 * account A's content cannot be replayed against account B's path (the
 * recomputed HMAC won't match). The backend only ever mints signatures for the
 * authenticated caller's own accountConfigId, so a caller can never obtain a
 * valid signature for another account. This is the presigned-URL capability
 * model the export flow already uses: possession of the URL grants access until
 * it expires, bounded by a short TTL.
 */

const KEY_DERIVATION_LABEL = "remit-content-url-signing-v1";

/**
 * Default validity window for a signed content URL. Long enough to cover a
 * viewing session (react-query caches describeMessage for 30 min and inline
 * images may load late), short enough to bound the replay window if a URL
 * leaks.
 */
export const CONTENT_URL_TTL_SECONDS = 3600;

/**
 * Derive a purpose-specific signing subkey from the master secret. Domain
 * separation via a fixed label keeps the content-signing key distinct from the
 * raw better-auth secret, so a compromise of one signing space does not reveal
 * the other. Reusing `BETTER_AUTH_SECRET` as the master means no new secret has
 * to be provisioned on the Postgres stack — it is already required there.
 */
const deriveSigningKey = (masterSecret: string): Buffer =>
	createHmac("sha256", masterSecret).update(KEY_DERIVATION_LABEL).digest();

const canonicalMessage = (relativePath: string, exp: number): string =>
	`${relativePath}\n${exp}`;

const computeSignature = (
	key: Buffer,
	relativePath: string,
	exp: number,
): string =>
	createHmac("sha256", key)
		.update(canonicalMessage(relativePath, exp))
		.digest("base64url");

export interface ContentSignature {
	exp: number;
	sig: string;
}

/**
 * A function that signs a decoded, account-scoped storage path and returns the
 * `exp`/`sig` query params to append to its content URL.
 */
export type ContentSigner = (relativePath: string) => ContentSignature;

export const createContentSigner = (
	masterSecret: string,
	ttlSeconds: number = CONTENT_URL_TTL_SECONDS,
): ContentSigner => {
	const key = deriveSigningKey(masterSecret);
	return (relativePath) => {
		const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
		return { exp, sig: computeSignature(key, relativePath, exp) };
	};
};

/**
 * Build the content-URL signer for the current environment, or `undefined` when
 * signing does not apply. Signing is enforced on the self-host SQL backends
 * (postgres and sqlite), which serve `/content/*` straight from the backend
 * container; on AWS the Lambda@Edge JWT verifier guards `/content/*` and the URL
 * stays unsigned so CloudFront/S3 behaviour is unchanged. Throws on those
 * backends when the master secret is missing, so a misconfigured deploy fails
 * loud rather than shipping unsigned (unauthenticated) content URLs.
 */
export const getContentSigner = (): ContentSigner | undefined => {
	if (!usesBetterAuthJwt()) return undefined;
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret || secret.length === 0) {
		throw new Error(
			"a self-host SQL backend (postgres/sqlite) requires BETTER_AUTH_SECRET to sign content URLs",
		);
	}
	return createContentSigner(secret);
};

export type ContentSignatureFailure =
	| "missing"
	| "malformed"
	| "expired"
	| "bad-signature";

export type ContentSignatureResult =
	| { valid: true }
	| { valid: false; reason: ContentSignatureFailure };

/**
 * Verify a signed content request. Recomputes the HMAC over the requested path
 * and the supplied expiry and constant-time compares it against the presented
 * signature. Pure so the decision can be unit-tested without a live server.
 */
export const verifyContentSignature = (
	relativePath: string,
	expRaw: string | undefined,
	sig: string | undefined,
	masterSecret: string,
	nowSeconds: number,
): ContentSignatureResult => {
	if (!expRaw || !sig) return { valid: false, reason: "missing" };

	const exp = Number(expRaw);
	if (!Number.isInteger(exp) || exp <= 0) {
		return { valid: false, reason: "malformed" };
	}
	if (exp < nowSeconds) return { valid: false, reason: "expired" };

	const key = deriveSigningKey(masterSecret);
	const expected = Buffer.from(computeSignature(key, relativePath, exp));
	const presented = Buffer.from(sig);
	if (expected.length !== presented.length) {
		return { valid: false, reason: "bad-signature" };
	}
	if (!timingSafeEqual(expected, presented)) {
		return { valid: false, reason: "bad-signature" };
	}
	return { valid: true };
};
