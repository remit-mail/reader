/**
 * Build the public CloudFront URL that fetches a single body part for a
 * message. The path layout is what the Lambda@Edge JWT verifier expects
 * (PR 1 of #224): `/content/accounts/{accountConfigId}/{accountId}/messages/
 * {messageId}/parts/{partPath}`.
 *
 * The function is intentionally pure — domain comes from configuration so
 * tests can pin the output without env vars. `partPath` is passed through
 * `encodeURIComponent` because IMAP section paths are dot-separated digits
 * (e.g. `1`, `1.2`, `2.1.3`) but a defensive encode keeps the builder safe
 * if the path ever carries unexpected characters.
 */
import type { ContentSigner } from "./contentSignature.js";

export interface BuildContentUrlInput {
	domain: string;
	accountConfigId: string;
	accountId: string;
	messageId: string;
	partPath: string;
	/**
	 * When present (self-host stack), append an `exp`/`sig` signature scoped to
	 * this account's storage path. Absent on AWS, where Lambda@Edge guards the
	 * URL and the path stays unsigned. See `contentSignature.ts`.
	 */
	sign?: ContentSigner;
}

export interface BuildStorageContentUrlInput {
	domain: string;
	storageKey: string;
	sign?: ContentSigner;
}

export const buildStorageContentUrl = (
	input: BuildStorageContentUrlInput,
): string => {
	const { domain, storageKey, sign } = input;
	const normalizedDomain = domain.replace(/\/+$/, "");
	const base = normalizedDomain.startsWith("http")
		? normalizedDomain
		: `https://${normalizedDomain}`;
	// The signed message is the decoded, account-scoped storage path — the same
	// value the `/content` route recomputes from `req.path`. Keep it in lockstep
	// with the verifier's `req.path.replace(/^\/content\//, "")`.
	const safeKey = storageKey
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const url = `${base}/content/${safeKey}`;
	if (!sign) return url;
	const { exp, sig } = sign(storageKey);
	return `${url}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
};

export const buildContentUrl = (input: BuildContentUrlInput): string => {
	const { domain, accountConfigId, accountId, messageId, partPath, sign } =
		input;
	return buildStorageContentUrl({
		domain,
		storageKey: `accounts/${accountConfigId}/${accountId}/messages/${messageId}/parts/${partPath}`,
		sign,
	});
};
