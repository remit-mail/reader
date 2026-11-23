import { extractBearerToken } from "@remit/auth-service/verifier";
import { z } from "zod";
import {
	CONNECTED_APPS_PATH,
	CONSENT_PATH,
	DEVICE_PATH,
	LOGIN_PATH,
	MCP_PATH,
	type McpAuthRoutes,
	type McpBrowserRoutes,
	mcpResource,
} from "./auth/authorization-server.js";
import { MCP_OPERATOR_SCOPE, MCP_SCOPES } from "./auth/scopes.js";
import type { TokenVerifier } from "./auth/token-verifier.js";
import type { McpDeps } from "./deps.js";
import { errorPage, pageError } from "./pages/render.js";
import {
	type ConnectedAppGrant,
	connectedAppsView,
	consentView,
	deviceView,
	loginView,
} from "./pages/views.js";
import { createMcpHandler, type McpRequestHandler } from "./server.js";

export interface McpResourceConfig {
	origin: string;
}

export interface McpPagesConfig extends McpResourceConfig {
	authRoutes: McpAuthRoutes;
}

export interface McpAppConfig extends McpPagesConfig {
	verifier: TokenVerifier;
	deps: McpDeps;
}

export type McpChallengeError = "unauthorized" | "invalid_token";

const PROTECTED_RESOURCE_METADATA_PATH =
	"/.well-known/oauth-protected-resource";
const RESOURCE_METADATA_PATH = `${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;

export const challenge = (
	{ origin }: McpResourceConfig,
	error: McpChallengeError,
): Response =>
	new Response(JSON.stringify({ error, resource: mcpResource(origin) }), {
		status: 401,
		headers: {
			"content-type": "application/json",
			"www-authenticate": [
				"Bearer",
				` resource_metadata="${origin}${RESOURCE_METADATA_PATH}",`,
				` scope="${MCP_SCOPES.join(" ")}"`,
				error === "unauthorized" ? "" : `, error="${error}"`,
			].join(""),
		},
	});

export const protectedResourceMetadata = ({
	origin,
}: McpResourceConfig): Response =>
	Response.json({
		resource: mcpResource(origin),
		authorization_servers: [origin],
		scopes_supported: [...MCP_SCOPES, MCP_OPERATOR_SCOPE],
		bearer_methods_supported: ["header"],
	});

const RETURN_PATHS: ReadonlySet<string> = new Set([
	DEVICE_PATH,
	CONNECTED_APPS_PATH,
]);

const connectedAppsSchema = z.object({
	apps: z.array(
		z.object({
			clientId: z.string(),
			clientName: z.string(),
			scopes: z.array(z.string()),
			connectedAt: z.coerce.date(),
		}),
	),
});

const redirectSchema = z.object({ url: z.string() });

const failureSchema = z.object({
	message: z.string().optional(),
	error_description: z.string().optional(),
});

const failureOf = async (response: Response): Promise<string> => {
	const failure = failureSchema.parse(await response.json());
	return (
		failure.error_description ??
		failure.message ??
		`The request failed with status ${response.status}.`
	);
};

const formString = (form: FormData, name: string): string => {
	const value = form.get(name);
	return typeof value === "string" ? value : "";
};

const consentScopes = (query: string, granted: boolean): string => {
	const params = new URLSearchParams(query);
	const scopes = (params.get("scope") ?? "")
		.split(" ")
		.filter((scope) => scope.length > 0 && scope !== MCP_OPERATOR_SCOPE);
	if (
		granted &&
		(params.get("scope") ?? "").split(" ").includes(MCP_OPERATOR_SCOPE)
	)
		scopes.push(MCP_OPERATOR_SCOPE);
	return scopes.join(" ");
};

const redirectWithCookies = (location: string, from: Response): Response => {
	const headers = new Headers({ location, "cache-control": "no-store" });
	for (const cookie of from.headers.getSetCookie()) {
		headers.append("set-cookie", cookie);
	}
	return new Response(null, { status: 302, headers });
};

export const createMcpPages = ({
	origin,
	authRoutes,
}: McpPagesConfig): McpRequestHandler => {
	const continueFrom = async (response: Response): Promise<Response> => {
		if (!response.ok) {
			return errorPage(
				"Connecting failed",
				await failureOf(response),
				"Go back to your MCP client and connect remit again.",
				response.status,
			);
		}
		const { url } = redirectSchema.parse(await response.json());
		return redirectWithCookies(url, response);
	};

	const disabledPage = (): Response =>
		errorPage(
			"Access refused",
			"This account is disabled.",
			"Ask the person who runs this remit server to restore your account.",
			403,
		);

	const toLogin = (returnTo: string): Response => {
		if (authRoutes.browser.kind === "host") {
			return errorPage(
				"Not signed in",
				"This server could not tell who you are.",
				"Sign in to remit, then open this page again.",
				401,
			);
		}
		return new Response(null, {
			status: 302,
			headers: {
				location: `${LOGIN_PATH}?${new URLSearchParams({ return_to: returnTo })}`,
				"cache-control": "no-store",
			},
		});
	};

	const returnToOf = (raw: string): string => {
		if (!raw.startsWith("/") || raw.startsWith("//"))
			return CONNECTED_APPS_PATH;
		const url = new URL(raw, origin);
		if (url.origin !== origin || !RETURN_PATHS.has(url.pathname)) {
			return CONNECTED_APPS_PATH;
		}
		return `${url.pathname}${url.search}`;
	};

	const login = async (
		request: Request,
		signIn: Extract<McpBrowserRoutes, { kind: "signIn" }>["signIn"],
	): Promise<Response> => {
		if (request.method === "GET") {
			const url = new URL(request.url);
			if (url.search === "" || url.searchParams.has("return_to")) {
				return loginView({
					return_to: returnToOf(url.searchParams.get("return_to") ?? ""),
				});
			}
			return loginView({ oauth_query: url.search.slice(1) });
		}
		const form = await request.formData();
		const oauthQuery = formString(form, "oauth_query");
		const returnTo = returnToOf(formString(form, "return_to"));
		const hiddenFields: Record<string, string> = oauthQuery
			? { oauth_query: oauthQuery }
			: { return_to: returnTo };
		const email = formString(form, "email");
		const response = await signIn(request.headers, {
			email,
			password: formString(form, "password"),
			oauth_query: oauthQuery,
		});
		if (response.status === 401) {
			return loginView(
				hiddenFields,
				401,
				email,
				pageError(
					"Wrong email or password.",
					"Check both and try again. It is the password you sign in to remit with.",
				),
			);
		}
		if (response.status === 429) {
			return loginView(
				hiddenFields,
				429,
				email,
				pageError(
					"Too many sign-in attempts.",
					"Wait a minute, then try again.",
				),
			);
		}
		if (!oauthQuery && response.ok) {
			await response.body?.cancel();
			return redirectWithCookies(returnTo, response);
		}
		return continueFrom(response);
	};

	const consent = async (request: Request): Promise<Response> => {
		if (request.method === "GET") {
			const url = new URL(request.url);
			const clientId = url.searchParams.get("client_id") ?? "";
			const scopes = (url.searchParams.get("scope") ?? "")
				.split(" ")
				.filter((scope) => scope.length > 0);
			if ((await authRoutes.sessionOf(request.headers)) === "disabled") {
				return disabledPage();
			}
			const clientName = await authRoutes.clientName(request.headers, clientId);
			if (!clientName) {
				return errorPage(
					"Connecting failed",
					"This sign-in request names an app remit does not know.",
					"Go back to your MCP client and connect remit again.",
					400,
				);
			}
			return consentView(
				url.search.slice(1),
				clientName,
				scopes.filter((scope) => scope !== MCP_OPERATOR_SCOPE),
				scopes.includes(MCP_OPERATOR_SCOPE) &&
					(await authRoutes.operatorOf(request.headers)),
			);
		}
		const form = await request.formData();
		const grantOperator =
			formString(form, "operator") === "true" &&
			(await authRoutes.operatorOf(request.headers));
		return continueFrom(
			await authRoutes.consent(request.headers, {
				accept: formString(form, "accept") === "true",
				oauth_query: formString(form, "oauth_query"),
				scope: consentScopes(formString(form, "oauth_query"), grantOperator),
			}),
		);
	};

	const device = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const session = await authRoutes.sessionOf(request.headers);
		if (session === "disabled") return disabledPage();
		if (session === "absent") {
			return toLogin(`${url.pathname}${url.search}`);
		}
		if (request.method === "GET") {
			const userCode = (url.searchParams.get("user_code") ?? "").trim();
			if (!userCode) return deviceView({ kind: "enter", userCode: "" });
			const claimed = await authRoutes.claimDeviceCode(
				request.headers,
				userCode,
			);
			if (!claimed.ok)
				return deviceView(
					{
						kind: "enter",
						userCode,
						error: pageError(
							await failureOf(claimed),
							"Use the new code shown by the CLI if pairing expired.",
						),
					},
					claimed.status,
				);
			const state = (await claimed.json()) as { status: string };
			if (state.status !== "pending")
				return deviceView({
					kind: state.status === "approved" ? "approved" : "denied",
				});
			return deviceView({ kind: "confirm", userCode });
		}
		const form = await request.formData();
		const userCode = formString(form, "user_code");
		const approve = formString(form, "action") === "approve";
		const claimed = await authRoutes.claimDeviceCode(request.headers, userCode);
		if (!claimed.ok)
			return deviceView(
				{
					kind: "enter",
					userCode,
					error: pageError(
						await failureOf(claimed),
						"Use the new code shown by the CLI if pairing expired.",
					),
				},
				claimed.status,
			);
		await claimed.body?.cancel();
		const response = await authRoutes.decideDeviceCode(
			request.headers,
			userCode,
			approve,
		);
		if (response.status === 401) {
			return toLogin(
				`${DEVICE_PATH}?${new URLSearchParams({ user_code: userCode })}`,
			);
		}
		if (!response.ok) {
			return deviceView(
				{
					kind: "enter",
					userCode,
					error: pageError(
						await failureOf(response),
						"Use the new code shown by the CLI if pairing expired.",
					),
				},
				response.status,
			);
		}
		await response.body?.cancel();
		return deviceView({ kind: approve ? "approved" : "denied" });
	};

	const listConnectedApps = async (
		request: Request,
	): Promise<ConnectedAppGrant[] | Response> => {
		const response = await authRoutes.connectedApps(request.headers);
		if (response.status === 401) {
			await response.body?.cancel();
			return toLogin(CONNECTED_APPS_PATH);
		}
		if (response.status === 403) {
			await response.body?.cancel();
			return disabledPage();
		}
		if (!response.ok) {
			throw new Error(
				`Listing connected apps failed with ${response.status}: ${await response.text()}`,
			);
		}
		return connectedAppsSchema.parse(await response.json()).apps;
	};

	const connectedApps = async (request: Request): Promise<Response> => {
		if (request.method === "GET") {
			const apps = await listConnectedApps(request);
			if (apps instanceof Response) return apps;
			return connectedAppsView(apps);
		}
		const form = await request.formData();
		const clientId = formString(form, "client_id");
		const before = await listConnectedApps(request);
		if (before instanceof Response) return before;
		const name =
			before.find((app) => app.clientId === clientId)?.clientName ?? clientId;
		const response = await authRoutes.revokeClient(request.headers, clientId);
		if (response.status === 401) return toLogin(CONNECTED_APPS_PATH);
		if (!response.ok) {
			return connectedAppsView(
				before,
				response.status,
				undefined,
				pageError(
					`Disconnecting ${name} failed: ${await failureOf(response)}`,
					"Reload the page and try again.",
				),
			);
		}
		await response.body?.cancel();
		const after = await listConnectedApps(request);
		if (after instanceof Response) return after;
		return connectedAppsView(after, 200, name);
	};

	return async (request) => {
		const { pathname } = new URL(request.url);
		if (pathname === "/.well-known/oauth-authorization-server") {
			return authRoutes.serverMetadata(request);
		}
		if (
			pathname === RESOURCE_METADATA_PATH ||
			pathname === PROTECTED_RESOURCE_METADATA_PATH
		) {
			return protectedResourceMetadata({ origin });
		}
		if (pathname === LOGIN_PATH && authRoutes.browser.kind === "signIn") {
			return login(request, authRoutes.browser.signIn);
		}
		if (pathname === CONSENT_PATH) return consent(request);
		if (pathname === DEVICE_PATH) return device(request);
		if (pathname === CONNECTED_APPS_PATH) return connectedApps(request);
		return authRoutes.handle(request);
	};
};

export const createMcpApp = (config: McpAppConfig): McpRequestHandler => {
	const pages = createMcpPages(config);
	const serveMcp = async (request: Request): Promise<Response> => {
		const bearer = extractBearerToken(
			request.headers.get("authorization") ?? undefined,
		);
		if (!bearer) return challenge(config, "unauthorized");
		const verification = await config.verifier.verify(bearer);
		if (!verification.ok) return challenge(config, "invalid_token");
		return createMcpHandler(
			verification.principal,
			config.deps,
			await config.authRoutes.isOperator(verification.principal.userId),
		)(request);
	};
	return (request) => {
		if (new URL(request.url).pathname === MCP_PATH) return serveMcp(request);
		return pages(request);
	};
};
