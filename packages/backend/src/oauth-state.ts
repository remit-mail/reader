import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccountService as AccountServiceName } from "@remit/api-openapi-types";
import { AccountService } from "@remit/domain-enums";

export interface OAuthState {
	accountConfigId: string;
	nonce: string;
	timestamp: number;
	services: AccountServiceName[];
}

const ACCOUNT_SERVICES: readonly string[] = Object.values(AccountService);

const isServiceList = (value: unknown): value is AccountServiceName[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every(
		(service) =>
			typeof service === "string" && ACCOUNT_SERVICES.includes(service),
	);

export const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Derive a signing key from the client secret, namespaced to avoid reuse.
 * The key is HMAC-SHA256("oauth-state-signing:" + clientSecret).
 */
function deriveSigningKey(clientSecret: string): Buffer {
	return createHmac("sha256", `oauth-state-signing:${clientSecret}`)
		.update("")
		.digest();
}

function base64urlEncode(buf: Buffer): string {
	return buf.toString("base64url");
}

function base64urlDecode(str: string): Buffer {
	return Buffer.from(str, "base64url");
}

export async function signState(
	payload: OAuthState,
	clientSecret: string,
): Promise<string> {
	const key = deriveSigningKey(clientSecret);
	const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
	const payloadEncoded = base64urlEncode(payloadBuf);
	const sig = createHmac("sha256", key).update(payloadEncoded).digest();
	const sigEncoded = base64urlEncode(sig);
	return `${payloadEncoded}.${sigEncoded}`;
}

export async function verifyState(
	state: string,
	clientSecret: string,
): Promise<OAuthState> {
	const dotIndex = state.lastIndexOf(".");
	if (dotIndex < 0) throw new Error("Malformed state: missing dot separator");

	const payloadEncoded = state.slice(0, dotIndex);
	const sigEncoded = state.slice(dotIndex + 1);

	const key = deriveSigningKey(clientSecret);
	const expectedSig = createHmac("sha256", key).update(payloadEncoded).digest();
	const actualSig = base64urlDecode(sigEncoded);

	if (
		actualSig.length !== expectedSig.length ||
		!timingSafeEqual(actualSig, expectedSig)
	) {
		throw new Error("State signature verification failed");
	}

	const payload = JSON.parse(
		base64urlDecode(payloadEncoded).toString("utf8"),
	) as OAuthState;

	if (Date.now() - payload.timestamp > STATE_TTL_MS) {
		throw new Error("State has expired");
	}

	if (payload.services === undefined) {
		return { ...payload, services: [AccountService.Mail] };
	}

	if (!isServiceList(payload.services)) {
		throw new Error("State names no requested services");
	}

	return payload;
}

/** The web client's account settings, where every Microsoft sign-in lands. */
export const ACCOUNT_SETTINGS_ROUTE = "/settings/accounts";

/** Where a refused Microsoft sign-in sends the browser back to, carrying why. */
export const oauthRefusalUrl = (
	webOrigin: string,
	oauthError: string,
): string => {
	const url = new URL(`${webOrigin}${ACCOUNT_SETTINGS_ROUTE}`);
	url.searchParams.set("oauthError", oauthError);
	return url.toString();
};
