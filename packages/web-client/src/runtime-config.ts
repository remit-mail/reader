/**
 * Deploy-specific configuration, read at runtime from `window.__REMIT_CONFIG__`
 * (set by `/config.js`, loaded before the app bundle). One built artifact serves
 * every deployment: the self-host image ships a default `config.js`, the AWS
 * deploy writes one with Cognito values, and the dev server injects one from
 * `REMIT_RUNTIME_CONFIG`. Nothing here is baked at build time.
 */

export interface CognitoConfig {
	userPoolId: string;
	clientId: string;
	domain: string;
	region: string;
}

export interface RumConfig {
	appMonitorId: string;
	identityPoolId: string;
	region: string;
}

/**
 * The deployment's TLS termination, mirroring TLS_MODE (deploy/vps/remit.env.template).
 * "internal" is the only mode with a locally-signed root CA worth offering for
 * download — the others are already publicly trusted or plain HTTP.
 */
export type TlsMode = "internal" | "acme" | "tailscale" | "off";

export type UpdateMode = "self" | "managed";

const DEFAULT_ISSUES_URL = "https://github.com/remit-mail/reader/issues/new";

const TLS_MODES: readonly TlsMode[] = ["internal", "acme", "tailscale", "off"];

const UPDATE_MODES: readonly UpdateMode[] = ["self", "managed"];

const oneOf = <T extends string>(
	values: readonly T[],
	raw: unknown,
	fallback: T,
): T => values.find((value) => value === raw) ?? fallback;

export interface RemitRuntimeConfig {
	apiUrl: string;
	appOrigin: string;
	betterAuthEnabled: boolean;
	cognito: CognitoConfig;
	rum: RumConfig;
	mailboxPollIntervalSeconds?: string;
	disableDevtools: boolean;
	tlsMode: TlsMode;
	issuesUrl: string;
	updateMode: UpdateMode;
}

interface RawRuntimeConfig {
	apiUrl?: string;
	appOrigin?: string;
	betterAuthEnabled?: boolean;
	cognito?: Partial<CognitoConfig>;
	rum?: Partial<RumConfig>;
	mailboxPollIntervalSeconds?: string | number;
	disableDevtools?: boolean;
	tlsMode?: string;
	issuesUrl?: string;
	updateMode?: string;
}

declare global {
	var __REMIT_CONFIG__: RawRuntimeConfig | undefined;
}

/**
 * Read `window.__REMIT_CONFIG__` fresh on each call and normalize it. Reading at
 * call time (not module load) keeps it re-evaluable: the browser sets the global
 * once before boot, and tests swap it between cases.
 */
export const getRuntimeConfig = (): RemitRuntimeConfig => {
	const raw: RawRuntimeConfig = globalThis.__REMIT_CONFIG__ ?? {};
	return {
		apiUrl: raw.apiUrl ?? "/api",
		appOrigin: raw.appOrigin ?? "",
		betterAuthEnabled: raw.betterAuthEnabled ?? false,
		cognito: {
			userPoolId: raw.cognito?.userPoolId ?? "",
			clientId: raw.cognito?.clientId ?? "",
			domain: raw.cognito?.domain ?? "",
			region: raw.cognito?.region ?? "",
		},
		rum: {
			appMonitorId: raw.rum?.appMonitorId ?? "",
			identityPoolId: raw.rum?.identityPoolId ?? "",
			region: raw.rum?.region ?? "eu-west-1",
		},
		mailboxPollIntervalSeconds:
			raw.mailboxPollIntervalSeconds != null
				? String(raw.mailboxPollIntervalSeconds)
				: undefined,
		disableDevtools: raw.disableDevtools ?? false,
		tlsMode: oneOf(TLS_MODES, raw.tlsMode, "off"),
		issuesUrl: raw.issuesUrl ?? DEFAULT_ISSUES_URL,
		updateMode: oneOf(UPDATE_MODES, raw.updateMode, "self"),
	};
};
