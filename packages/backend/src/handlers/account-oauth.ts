import { randomBytes } from "node:crypto";
import type {
	AccountService as AccountServiceName,
	MicrosoftOAuthStartRequest,
} from "@remit/api-openapi-types";
import { ensureAccountConfig } from "@remit/data-ports/account-config";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
} from "@remit/domain-enums";
import { logger } from "@remit/logger";
import {
	createMailOAuthService,
	type MailOAuthService,
	microsoftProviderConfig,
	microsoftServicesGranted,
	orderServices,
	RefreshTokenError,
} from "@remit/mail-oauth-service";
import { serializeEncryptedPayload } from "@remit/secrets-service";
import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { loadMsOAuth } from "../config/msoauth.js";
import { safeJsonParse } from "../json.js";
import { type OAuthState, signState, verifyState } from "../oauth-state.js";
import { rawApiResponse } from "../response.js";
import type { QueueName } from "../service/queues.js";
import type {
	HandlerContext,
	MicrosoftOAuthOperationIds,
	OperationHandler,
	PublicHandlerContext,
	PublicOperationHandler,
	PublicOperationIds,
} from "../types.js";
import { triggerAccountSyncSafe } from "./account.js";
import { findActiveDuplicateMailbox } from "./account-guards.js";

const OUTLOOK_IMAP_HOST = "outlook.office365.com";

// ─── JWT claims parsing ──────────────────────────────────────────────────────

export async function parseJwtClaims(
	token: string,
): Promise<Record<string, unknown> | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	return safeJsonParse<Record<string, unknown>>(
		Buffer.from(parts[1], "base64url").toString("utf8"),
	).catch(() => null);
}

// ─── Web origin helper ───────────────────────────────────────────────────────

export function getWebOrigin(origins: readonly string[]): string {
	// Prefer the first HTTPS origin (production frontend)
	const httpsOrigin = origins.find((o) => o.startsWith("https://"));
	return httpsOrigin ?? origins[0] ?? "https://localhost:3000";
}

type ScopeRedemption =
	| { kind: "granted"; refreshToken: string; grantedScopes: string[] }
	| { kind: "refused"; reason: "exchange_failed" }
	| {
			kind: "refused";
			reason: "scope_not_granted";
			service: AccountServiceName;
	  };

const scopeRefusalUrl = (
	webOrigin: string,
	email: string,
	missingServices: readonly AccountServiceName[],
): string => {
	const url = new URL(`${webOrigin}/settings/accounts`);
	url.searchParams.set("oauthError", "scope_not_granted");
	url.searchParams.set("oauthEmail", email);
	url.searchParams.set("missingServices", missingServices.join(","));
	return url.toString();
};

const redeemEachService = async (
	serviceFor: (service: AccountServiceName) => MailOAuthService,
	initialToken: string,
	services: readonly AccountServiceName[],
	accountConfigId: string,
): Promise<ScopeRedemption> => {
	let token = initialToken;
	const grantedScopes: string[] = [];
	for (const service of services) {
		const redeemed = await serviceFor(service)
			.refresh(token)
			.catch((err: unknown) => {
				logger.warn(
					{
						alert: "oauth_callback_failed",
						reason: "scope_redemption_failed",
						accountConfigId,
						service,
						error: err,
					},
					"MS OAuth callback: the consent did not cover a requested service",
				);
				return err instanceof RefreshTokenError &&
					err.error.kind === "transient"
					? ("exchange_failed" as const)
					: ("scope_not_granted" as const);
			});
		if (redeemed === "exchange_failed")
			return { kind: "refused", reason: redeemed };
		if (redeemed === "scope_not_granted")
			return { kind: "refused", reason: redeemed, service };
		grantedScopes.push(...redeemed.grantedScopes);
		token = redeemed.refreshToken ?? token;
	}
	return { kind: "granted", refreshToken: token, grantedScopes };
};

// ─── Handlers ────────────────────────────────────────────────────────────────

export const microsoftOAuthCallback: PublicOperationHandler<"sync"> = async (
	context: Context,
	ctx: PublicHandlerContext<"sync">,
): Promise<APIGatewayProxyResult> => {
	const webOrigin = getWebOrigin(ctx.config.corsAllowedOrigins);
	const qs = context.request.query as Record<string, string | undefined>;

	// Marked raw so the response formatter forwards the Location header
	// instead of serializing this object as a JSON body. Microsoft's browser
	// redirect lands here, so a dropped Location is a blank page.
	const redirect = (url: string): APIGatewayProxyResult =>
		rawApiResponse({
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
		return redirect(`${webOrigin}/settings/accounts?oauthError=missing_params`);
	}

	const loaded = await loadMsOAuth(ctx.config.msOAuth).catch((err: unknown) => {
		logger.error(
			{
				alert: "oauth_callback_failed",
				reason: "config_error",
				errorName: (err as { name?: string })?.name,
				errorCode:
					(err as { Code?: string })?.Code ?? (err as { code?: string })?.code,
				error: err,
			},
			"MS OAuth callback: failed to load OAuth config",
		);
		return null;
	});
	if (loaded === null)
		return redirect(`${webOrigin}/settings/accounts?oauthError=config_error`);
	const { config, credentials } = loaded;

	// Verify the HMAC-signed state
	// A bad/expired/forged state is a security-relevant signal (CSRF
	// attempt, clock skew, or a stale callback) — must not be swallowed
	// silently. Warn so it's observable; still redirect the user cleanly.
	const statePayload = await verifyState(state, credentials.clientSecret).catch(
		(err: unknown) => {
			logger.warn(
				{
					alert: "oauth_callback_failed",
					reason: "invalid_state",
					errorName: (err as { name?: string })?.name,
					error: err,
				},
				"MS OAuth callback: state verification failed",
			);
			return null;
		},
	);
	if (statePayload === null)
		return redirect(`${webOrigin}/settings/accounts?oauthError=invalid_state`);

	const { accountConfigId } = statePayload;
	const [firstService] = orderServices(statePayload.services);

	const serviceFor = (service: AccountServiceName): MailOAuthService =>
		createMailOAuthService(
			microsoftProviderConfig({
				clientId: credentials.clientId,
				clientSecret: credentials.clientSecret,
				services: [service],
				overrides: config.overrides,
			}),
		);

	// Exchange the authorization code for tokens
	const tokenSet = await serviceFor(firstService)
		.exchangeCode(code, config.redirectUri)
		.catch((err: unknown) => {
			logger.error(
				{ accountConfigId, error: err },
				"MS OAuth code exchange failed",
			);
			return null;
		});
	if (tokenSet === null)
		return redirect(
			`${webOrigin}/settings/accounts?oauthError=exchange_failed`,
		);

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
	const tokenToParse = tokenSet.idToken ?? tokenSet.accessToken;
	const claims = await parseJwtClaims(tokenToParse);
	if (!claims) {
		// A non-JWT or unparseable token. The empty-email guard below turns
		// this into a user-facing missing_email redirect; log here so the parse
		// failure itself is observable (e.g. an unexpected token shape).
		logger.warn(
			{
				alert: "oauth_callback_failed",
				reason: "jwt_parse_failed",
				accountConfigId,
			},
			"MS OAuth callback: failed to parse identity token claims",
		);
	}
	const email = claims
		? ((claims.preferred_username as string | undefined) ??
			(claims.email as string | undefined) ??
			(claims.upn as string | undefined))
		: undefined;

	if (!email) {
		logger.error(
			{ accountConfigId },
			"MS OAuth: could not extract email from token claims",
		);
		return redirect(`${webOrigin}/settings/accounts?oauthError=missing_email`);
	}

	const { account, accountConfig, secrets } = ctx.client;

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

	const services = orderServices([
		...statePayload.services,
		...(existing?.syncedServices ?? []),
	]);

	const redemption = await redeemEachService(
		serviceFor,
		tokenSet.refreshToken,
		services.filter((service) => service !== firstService),
		accountConfigId,
	);
	if (
		redemption.kind === "refused" &&
		redemption.reason === "scope_not_granted"
	)
		return redirect(scopeRefusalUrl(webOrigin, email, [redemption.service]));
	if (redemption.kind === "refused")
		return redirect(
			`${webOrigin}/settings/accounts?oauthError=${redemption.reason}`,
		);

	const grantedScopes = [
		...new Set([...tokenSet.grantedScopes, ...redemption.grantedScopes]),
	];
	const grantedServices = microsoftServicesGranted(grantedScopes);
	const missingServices = services.filter(
		(service) => !grantedServices.includes(service),
	);
	if (missingServices.length > 0) {
		logger.warn(
			{
				alert: "oauth_callback_failed",
				reason: "scope_not_granted",
				accountConfigId,
				missingServices,
				grantedScopes,
			},
			"MS OAuth callback: granted scopes lack a requested service",
		);
		return redirect(scopeRefusalUrl(webOrigin, email, missingServices));
	}

	// Ensure the account config row exists for this user
	await ensureAccountConfig(accountConfig, accountConfigId);

	// Encrypt the refresh token
	const tokenPayload = await secrets.encrypt(redemption.refreshToken);
	const oauthRefreshTokenHash = JSON.stringify(
		serializeEncryptedPayload(tokenPayload),
	);
	const oauthTokenUpdatedAt = Date.now();

	let accountId: string;

	if (existing) {
		// Reconnect: update the stored token and clear any reauth_required state
		const updated = await account.update(
			existing.accountId,
			{
				oauthRefreshTokenHash,
				oauthTokenUpdatedAt,
				syncedServices: services,
				grantedScopes,
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
			syncedServices: services,
			grantedScopes,
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

	if (services.includes(AccountService.Mail)) {
		await triggerAccountSyncSafe(ctx.client, accountId);
	}

	return redirect(
		`${webOrigin}/settings/accounts?connected=${encodeURIComponent(accountId)}`,
	);
};

export interface SignInNotConfigured {
	statusCode: 501;
	body: { code: "not_configured"; message: string };
}

/**
 * An instance with no Microsoft app answers the start of a sign-in with a
 * refusal the onboarding wizard can show, rather than the 500 the config load
 * would otherwise throw.
 */
const signInNotConfigured = (): SignInNotConfigured => ({
	statusCode: 501,
	body: {
		code: "not_configured",
		message:
			"Microsoft sign-in is not configured on this instance; connect the account with an app password instead.",
	},
});

export const MicrosoftOAuthOperations = {
	MicrosoftOAuthOperations_microsoftOAuthStart: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<{ authorizationUrl: string } | SignInNotConfigured> => {
		if (ctx.config.msOAuth.mode === "Disabled") return signInNotConfigured();
		const accountConfigId = ctx.identity.accountConfigId;

		const input = context.request.requestBody as MicrosoftOAuthStartRequest;
		const email = typeof input.email === "string" ? input.email : undefined;
		const services = orderServices(input.services ?? [AccountService.Mail]);

		const { config, credentials } = await loadMsOAuth(ctx.config.msOAuth);

		const oauthService = createMailOAuthService(
			microsoftProviderConfig({
				clientId: credentials.clientId,
				clientSecret: credentials.clientSecret,
				services,
				overrides: config.overrides,
			}),
		);

		const nonce = randomBytes(16).toString("hex");
		const statePayload: OAuthState = {
			accountConfigId,
			nonce,
			timestamp: Date.now(),
			services,
		};

		const state = await signState(statePayload, credentials.clientSecret);

		const authorizationUrl = oauthService.buildAuthorizationUrl({
			redirectUri: config.redirectUri,
			state,
			loginHint: email,
		});

		// biome-ignore lint/plugin/no-logger-info: OAuth initiation is an audit-grade signal
		logger.info(
			{ accountConfigId, services },
			"Microsoft OAuth start initiated",
		);

		return { authorizationUrl };
	},
} satisfies Record<
	Exclude<MicrosoftOAuthOperationIds, PublicOperationIds>,
	OperationHandler<MicrosoftOAuthOperationIds, QueueName>
>;
