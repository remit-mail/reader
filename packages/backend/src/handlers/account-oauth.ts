import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inspect } from "node:util";
import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import { logger } from "@remit/remit-logger-lambda";
import {
	createMailOAuthService,
	microsoftProviderConfig,
} from "@remit/mail-oauth-service";
import { serializeEncryptedPayload } from "@remit/secrets-service";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getMsOAuthConfig } from "../config/msoauth.js";
import { getClient } from "../service/dynamodb.js";
import type { MicrosoftOAuthOperationIds, OperationHandler } from "../types.js";
import { triggerAccountSyncSafe } from "./account.js";
import { findActiveDuplicateMailbox } from "./account-guards.js";
import { ensureAccountConfig } from "./ensure-account-config.js";

const OUTLOOK_IMAP_HOST = "outlook.office365.com";

// ─── HMAC state signing ──────────────────────────────────────────────────────

export interface OAuthState {
	accountConfigId: string;
	nonce: string;
	timestamp: number;
}

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

	return payload;
}

// ─── JWT claims parsing ──────────────────────────────────────────────────────

export function parseJwtClaims(token: string): Record<string, unknown> {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Invalid JWT: expected 3 parts");
	return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

// ─── Secrets Manager / config helpers ───────────────────────────────────────

interface MsOAuthCredentials {
	clientId: string;
	clientSecret: string;
}

let smClient: SecretsManagerClient | null = null;

function getSecretsManagerClient(): SecretsManagerClient {
	if (!smClient) smClient = new SecretsManagerClient({});
	return smClient;
}

async function getMsOAuthCredentials(): Promise<MsOAuthCredentials> {
	const config = getMsOAuthConfig();

	// Local dev: use env vars directly
	if (config.clientId && config.clientSecret) {
		return { clientId: config.clientId, clientSecret: config.clientSecret };
	}

	// Production: fetch from Secrets Manager
	if (!config.secretArn) {
		throw new Error(
			"MSOAUTH_SECRET_ARN is required when MSOAUTH_CLIENT_ID/MSOAUTH_CLIENT_SECRET are not set",
		);
	}

	const sm = getSecretsManagerClient();
	const result = await sm.send(
		new GetSecretValueCommand({ SecretId: config.secretArn }),
	);

	if (!result.SecretString) {
		throw new Error("MSOAUTH secret has no SecretString value");
	}

	const parsed = JSON.parse(result.SecretString) as MsOAuthCredentials;
	if (!parsed.clientId || !parsed.clientSecret) {
		throw new Error(
			"MSOAUTH secret must contain clientId and clientSecret fields",
		);
	}

	return parsed;
}

// ─── Web origin helper ───────────────────────────────────────────────────────

export function getWebOrigin(): string {
	const raw = process.env.CORS_ALLOWED_ORIGINS ?? "";
	const origins = raw
		.split(",")
		.map((o) => o.trim())
		.filter(Boolean);

	// Prefer the first HTTPS origin (production frontend)
	const httpsOrigin = origins.find((o) => o.startsWith("https://"));
	return httpsOrigin ?? origins[0] ?? "https://localhost:3000";
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export const MicrosoftOAuthOperations: Record<
	MicrosoftOAuthOperationIds,
	OperationHandler<MicrosoftOAuthOperationIds>
> = {
	MicrosoftOAuthOperations_microsoftOAuthStart: async (
		_context: Context,
		...args: unknown[]
	): Promise<{ authorizationUrl: string }> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);

		const input = JSON.parse(event.body ?? "{}") as { email?: string };
		const email = typeof input.email === "string" ? input.email : undefined;

		const config = getMsOAuthConfig();
		const credentials = await getMsOAuthCredentials();

		const oauthService = createMailOAuthService(
			microsoftProviderConfig({
				clientId: credentials.clientId,
				clientSecret: credentials.clientSecret,
				overrides: config.tokenEndpoint
					? { tokenEndpoint: config.tokenEndpoint }
					: undefined,
			}),
		);

		const nonce = randomBytes(16).toString("hex");
		const statePayload: OAuthState = {
			accountConfigId,
			nonce,
			timestamp: Date.now(),
		};

		const state = await signState(statePayload, credentials.clientSecret);

		const authorizationUrl = oauthService.buildAuthorizationUrl({
			redirectUri: config.redirectUri,
			state,
			loginHint: email,
		});

		// biome-ignore lint/plugin/no-logger-info: OAuth initiation is an audit-grade signal
		logger.info({ accountConfigId }, "Microsoft OAuth start initiated");

		return { authorizationUrl };
	},

	MicrosoftOAuthOperations_microsoftOAuthCallback: async (
		_context: Context,
		...args: unknown[]
	): Promise<APIGatewayProxyResult> => {
		const event = args[0] as APIGatewayProxyEvent;
		const webOrigin = getWebOrigin();
		const qs = event.queryStringParameters ?? {};

		const redirect = (url: string): APIGatewayProxyResult => ({
			statusCode: 302,
			headers: { Location: url },
			body: "",
		});

		// If Microsoft returned an error, pass it through to the frontend
		if (qs.error) {
			const errorCode = encodeURIComponent(qs.error);
			return redirect(`${webOrigin}/settings/accounts?oauthError=${errorCode}`);
		}

		const code = qs.code;
		const state = qs.state;

		if (!code || !state) {
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=missing_params`,
			);
		}

		let credentials: MsOAuthCredentials;
		try {
			credentials = await getMsOAuthCredentials();
		} catch (err: unknown) {
			logger.error(
				{
					alert: "oauth_callback_failed",
					reason: "config_error",
					errorName: (err as { name?: string })?.name,
					errorCode:
						(err as { Code?: string })?.Code ??
						(err as { code?: string })?.code,
					error: inspect(err),
				},
				"MS OAuth callback: failed to load OAuth config",
			);
			return redirect(`${webOrigin}/settings/accounts?oauthError=config_error`);
		}

		// Verify the HMAC-signed state
		let statePayload: OAuthState;
		try {
			statePayload = await verifyState(state, credentials.clientSecret);
		} catch (err: unknown) {
			// A bad/expired/forged state is a security-relevant signal (CSRF
			// attempt, clock skew, or a stale callback) — must not be swallowed
			// silently. Warn so it's observable; still redirect the user cleanly.
			logger.warn(
				{
					alert: "oauth_callback_failed",
					reason: "invalid_state",
					errorName: (err as { name?: string })?.name,
					error: inspect(err),
				},
				"MS OAuth callback: state verification failed",
			);
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=invalid_state`,
			);
		}

		const { accountConfigId } = statePayload;

		const config = getMsOAuthConfig();
		const oauthService = createMailOAuthService(
			microsoftProviderConfig({
				clientId: credentials.clientId,
				clientSecret: credentials.clientSecret,
				overrides: config.tokenEndpoint
					? { tokenEndpoint: config.tokenEndpoint }
					: undefined,
			}),
		);

		// Exchange the authorization code for tokens
		let tokenSet: Awaited<ReturnType<typeof oauthService.exchangeCode>>;
		try {
			tokenSet = await oauthService.exchangeCode(code, config.redirectUri);
		} catch (err: unknown) {
			logger.error(
				{ accountConfigId, error: inspect(err) },
				"MS OAuth code exchange failed",
			);
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=exchange_failed`,
			);
		}

		if (!tokenSet.refreshToken) {
			logger.error(
				{ accountConfigId },
				"MS OAuth token exchange returned no refresh_token",
			);
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=exchange_failed`,
			);
		}

		// Extract the user's email from the ID token returned alongside the access
		// token when openid+email scopes are requested.
		//
		// We prefer the ID token (idToken) because Outlook resource access tokens
		// (IMAP.AccessAsUser.All, SMTP.Send) are opaque/non-JWT and cannot be
		// decoded. The ID token is a standard OIDC token that always contains
		// identity claims (preferred_username / email).
		//
		// Falls back to parsing the access token only in test/dev environments where
		// idToken may not be present (e.g. custom token endpoints that don't issue
		// OIDC tokens).
		let email: string | undefined;
		try {
			const tokenToParse = tokenSet.idToken ?? tokenSet.accessToken;
			const claims = parseJwtClaims(tokenToParse);
			email =
				(claims.preferred_username as string | undefined) ??
				(claims.email as string | undefined) ??
				(claims.upn as string | undefined);
		} catch (err: unknown) {
			// Not a JWT or missing claims. The empty-email check below turns this
			// into a user-facing missing_email redirect, but log here so the
			// parse failure itself is observable (e.g. an unexpected token shape).
			logger.warn(
				{
					alert: "oauth_callback_failed",
					reason: "jwt_parse_failed",
					accountConfigId,
					errorName: (err as { name?: string })?.name,
					error: inspect(err),
				},
				"MS OAuth callback: failed to parse identity token claims",
			);
		}

		if (!email) {
			logger.error(
				{ accountConfigId },
				"MS OAuth: could not extract email from token claims",
			);
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=missing_email`,
			);
		}

		const { account, accountConfig, secrets } = getClient();

		// Ensure the account config row exists for this user
		await ensureAccountConfig(accountConfig, accountConfigId);

		// Encrypt the refresh token
		const tokenPayload = await secrets.encrypt(tokenSet.refreshToken);
		const oauthRefreshTokenHash = JSON.stringify(
			serializeEncryptedPayload(tokenPayload),
		);
		const oauthTokenUpdatedAt = Date.now();

		// Reconnect when an active OAuth account already onboards this mailbox.
		// Same natural key as the IMAP create guard (#635); the OAuth flow returns
		// the existing account (token refresh) rather than rejecting, because a
		// re-auth is the expected, idempotent path for OAuth.
		const existingAccounts = (
			await account.listAllByAccountConfig(accountConfigId)
		).filter((a) => a.authType === AccountAuthType.OauthMicrosoft);
		const existing = findActiveDuplicateMailbox(existingAccounts, {
			imapHost: OUTLOOK_IMAP_HOST,
			username: email,
		});

		let accountId: string;

		if (existing) {
			// Reconnect: update the stored token and clear any reauth_required state
			const updated = await account.update(
				existing.accountId,
				{
					oauthRefreshTokenHash,
					oauthTokenUpdatedAt,
					connectionState: ConnectionState.NotAuthenticated,
				},
				["lastError"] as never,
			);
			accountId = updated.accountId;
			// biome-ignore lint/plugin/no-logger-info: OAuth reconnect is an audit-grade signal
			logger.info(
				{ accountConfigId, accountId },
				"MS OAuth reconnect: refresh token updated",
			);
		} else {
			// First connect: create a new account
			const newAccount = await account.create({
				accountConfigId,
				email,
				username: email,
				authType: AccountAuthType.OauthMicrosoft,
				oauthRefreshTokenHash,
				oauthTokenUpdatedAt,
				imapHost: OUTLOOK_IMAP_HOST,
				imapPort: 993,
				imapTls: true,
				imapStartTls: false,
				smtpEnabled: true,
				smtpHost: "smtp.office365.com",
				smtpPort: 587,
				smtpTls: false,
				smtpStartTls: true,
				isActive: true,
				connectionState: ConnectionState.NotAuthenticated,
			});
			accountId = newAccount.accountId;
			// biome-ignore lint/plugin/no-logger-info: OAuth account creation is an audit-grade signal
			logger.info(
				{ accountConfigId, accountId },
				"MS OAuth: new account created",
			);
		}

		await triggerAccountSyncSafe(accountId);

		return redirect(
			`${webOrigin}/settings/accounts?connected=${encodeURIComponent(accountId)}`,
		);
	},
};
