import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The HMAC scheme behind every signed storage URL this stack mints.
 *
 * It started as the read side — `/content/*` is served against a signature
 * because a bearer token cannot ride on an `<img src>` inside email HTML — and
 * the write side needs exactly the same capability: a URL that grants access to
 * one path, for a while, and is unforgeable without the key. Rather than a
 * second scheme, both use this one with a different derivation label, so a
 * signature minted to read content can never be replayed as permission to
 * write, and vice versa.
 *
 * The signed message is the storage path followed by every claim in a fixed
 * order. Because the path is part of the message, a signature minted for one
 * account's object cannot be presented for another's.
 */

const deriveSigningKey = (masterSecret: string, label: string): Buffer =>
	createHmac("sha256", masterSecret).update(label).digest();

const canonicalMessage = (
	relativePath: string,
	claims: readonly number[],
): string => [relativePath, ...claims].join("\n");

const computeSignature = (
	key: Buffer,
	relativePath: string,
	claims: readonly number[],
): string =>
	createHmac("sha256", key)
		.update(canonicalMessage(relativePath, claims))
		.digest("base64url");

export const signStoragePath = (
	masterSecret: string,
	label: string,
	relativePath: string,
	claims: readonly number[],
): string =>
	computeSignature(deriveSigningKey(masterSecret, label), relativePath, claims);

export type SignedPathFailure =
	| "missing"
	| "malformed"
	| "expired"
	| "bad-signature";

export type SignedPathResult =
	| { valid: true }
	| { valid: false; reason: SignedPathFailure };

/**
 * Verify a presented signature against the path and claims it must cover. The
 * first claim is always the expiry, in unix seconds. Pure, so the decision can
 * be unit-tested without a live server.
 */
export const verifyStoragePath = (
	masterSecret: string,
	label: string,
	relativePath: string,
	claims: readonly number[],
	sig: string | undefined,
	nowSeconds: number,
): SignedPathResult => {
	if (!sig || claims.length === 0) return { valid: false, reason: "missing" };

	const [exp] = claims;
	if (!claims.every((claim) => Number.isInteger(claim) && claim > 0)) {
		return { valid: false, reason: "malformed" };
	}
	if (exp < nowSeconds) return { valid: false, reason: "expired" };

	const expected = Buffer.from(
		signStoragePath(masterSecret, label, relativePath, claims),
	);
	const presented = Buffer.from(sig);
	if (expected.length !== presented.length) {
		return { valid: false, reason: "bad-signature" };
	}
	if (!timingSafeEqual(expected, presented)) {
		return { valid: false, reason: "bad-signature" };
	}
	return { valid: true };
};
