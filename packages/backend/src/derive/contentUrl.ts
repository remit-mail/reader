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
export interface BuildContentUrlInput {
	domain: string;
	accountConfigId: string;
	accountId: string;
	messageId: string;
	partPath: string;
}

export const buildContentUrl = (input: BuildContentUrlInput): string => {
	const { domain, accountConfigId, accountId, messageId, partPath } = input;
	const normalizedDomain = domain.replace(/\/+$/, "");
	const base = normalizedDomain.startsWith("http")
		? normalizedDomain
		: `https://${normalizedDomain}`;
	const safePart = partPath
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `${base}/content/accounts/${accountConfigId}/${accountId}/messages/${messageId}/parts/${safePart}`;
};

/**
 * Read the CloudFront distribution domain from the environment. The CDK
 * wires `CONTENT_DELIVERY_DOMAIN` onto the API Lambda from the
 * ContentDelivery stack's published SSM parameter (`/{stage}/Remit/frontendUrl`).
 *
 * Throws when the env var is missing or empty. `BodyPartResponse.contentUrl`
 * is required + URL-formatted in the API contract, so silently emitting a
 * placeholder string would ship a contract lie to clients. Failing loud here
 * surfaces the missing wire-up as a 500 the deploy team can act on (#299).
 * Production synth hard-codes a syntactically-valid placeholder URL via
 * `infra/bin/infra.ts` so this only fires when the env is actually unset.
 */
export const getContentDeliveryDomain = (): string => {
	const value = process.env.CONTENT_DELIVERY_DOMAIN;
	if (!value || value.length === 0) {
		throw new Error(
			"CONTENT_DELIVERY_DOMAIN is not set; BodyPartResponse.contentUrl cannot be built. Wire the CloudFront distribution domain via the API Lambda env (see infra/bin/infra.ts).",
		);
	}
	return value;
};
