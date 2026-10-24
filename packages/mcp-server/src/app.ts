import { extractBearerToken } from "@remit/auth-service/verifier";
import { z } from "zod";
import {
	CONNECTED_APPS_PATH,
	CONSENT_PATH,
	DEVICE_PATH,
	LOGIN_PATH,
	MCP_PATH,
	type McpAuthRoutes,
	mcpResource,
} from "./auth/authorization-server.js";
import { MCP_SCOPES } from "./auth/scopes.js";
import type { TokenVerifier } from "./auth/token-verifier.js";
import type { McpDeps } from "./deps.js";
import {
	ASSETS_PATH_PREFIX,
	type PageAssets,
	serveAsset,
} from "./pages/assets.js";
import { errorPage, pageError } from "./pages/render.js";
import {
	type ConnectedAppGrant,
	connectedAppsView,
	consentView,
	deviceView,
	loginView,
} from "./pages/views.js";
import { createMcpHandler, type McpRequestHandler } from "./server.js";

export interface McpAppConfig {
	origin: string;
	authRoutes: McpAuthRoutes;
	verifier: TokenVerifier;
	deps: McpDeps;
	pageAssets: PageAssets;
}

const PROTECTED_RESOURCE_METADATA_PATH =
	"/.well-known/oauth-protected-resource";

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

const redirectWithCookies = (location: string, from: Response): Response => {
	const headers = new Headers({ location, "cache-control": "no-store" });
	for (const cookie of from.headers.getSetCookie()) {
		headers.append("set-cookie", cookie);
	}
	return new Response(null, { status: 302, headers });
};

export const createMcpApp = ({
	origin,
	authRoutes,
	verifier,
	deps,
	pageAssets,
}: McpAppConfig): McpRequestHandler => {
	const resource = mcpResource(origin);
	const resourceMetadataPath = `${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;
	const challenge = (error?: string): Response =>
		new Response(JSON.stringify({ error: error ?? "unauthorized", resource }), {
			status: 401,
			headers: {
				"content-type": "application/json",
				"www-authenticate": [
					"Bearer",
					` resource_metadata="${origin}${resourceMetadataPath}",`,
					` scope="${MCP_SCOPES.join(" ")}"`,
					error ? `, error="${error}"` : "",
				].join(""),
			},
		});

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

	const toLogin = (returnTo: string): Response =>
		new Response(null, {
			status: 302,
			headers: {
				location: `${LOGIN_PATH}?${new URLSearchParams({ return_to: returnTo })}`,
				"cache-control": "no-store",
			},
		});

	const returnToOf = (raw: string): string => {
		if (!raw.startsWith("/") || raw.startsWith("//"))
			return CONNECTED_APPS_PATH;
		const url = new URL(raw, origin);
		if (url.origin !== origin || !RETURN_PATHS.has(url.pathname)) {
			return CONNECTED_APPS_PATH;
		}
		return `${url.pathname}${url.search}`;
	};

	const login = async (request: Request): Promise<Response> => {
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
		const response = await authRoutes.signIn(request.headers, {
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
			const clientName = await authRoutes.clientName(request.headers, clientId);
			if (!clientName) {
				return errorPage(
					"Connecting failed",
					"This sign-in request names an app remit does not know.",
					"Go back to your MCP client and connect remit again.",
					400,
				);
			}
			return consentView(url.search.slice(1), clientName, scopes);
		}
		const form = await request.formData();
		return continueFrom(
			await authRoutes.consent(request.headers, {
				accept: formString(form, "accept") === "true",
				oauth_query: formString(form, "oauth_query"),
			}),
		);
	};

	const invalidCode = (userCode: string): Response =>
		deviceView(
			{
				kind: "enter",
				userCode,
				error: pageError(
					"That code is not valid or has expired.",
					"Run remit mcp login again and enter the new code.",
				),
			},
			400,
		);

	const device = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (!(await authRoutes.hasSession(request.headers))) {
			return toLogin(`${url.pathname}${url.search}`);
		}
		if (request.method === "GET") {
			const userCode = (url.searchParams.get("user_code") ?? "").trim();
			if (!userCode) return deviceView({ kind: "enter", userCode: "" });
			if (!(await authRoutes.claimDeviceCode(request.headers, userCode))) {
				return invalidCode(userCode);
			}
			return deviceView({ kind: "confirm", userCode });
		}
		const form = await request.formData();
		const userCode = formString(form, "user_code");
		const approve = formString(form, "action") === "approve";
		if (!(await authRoutes.claimDeviceCode(request.headers, userCode))) {
			return invalidCode(userCode);
		}
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
						"Run remit mcp login again and enter the new code.",
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
	): Promise<ConnectedAppGrant[] | undefined> => {
		const response = await authRoutes.connectedApps(request.headers);
		if (response.status === 401) {
			await response.body?.cancel();
			return undefined;
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
			if (!apps) return toLogin(CONNECTED_APPS_PATH);
			return connectedAppsView(apps);
		}
		const form = await request.formData();
		const clientId = formString(form, "client_id");
		const before = await listConnectedApps(request);
		if (!before) return toLogin(CONNECTED_APPS_PATH);
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
		if (!after) return toLogin(CONNECTED_APPS_PATH);
		return connectedAppsView(after, 200, name);
	};

	const serveMcp = async (request: Request): Promise<Response> => {
		const bearer = extractBearerToken(
			request.headers.get("authorization") ?? undefined,
		);
		if (!bearer) return challenge();
		const verification = await verifier.verify(bearer);
		if (!verification.ok) return challenge("invalid_token");
		return createMcpHandler(verification.principal, deps)(request);
	};

	return async (request) => {
		const { pathname } = new URL(request.url);
		if (pathname === "/.well-known/oauth-authorization-server") {
			return authRoutes.serverMetadata(request);
		}
		if (
			pathname === resourceMetadataPath ||
			pathname === PROTECTED_RESOURCE_METADATA_PATH
		) {
			return Response.json({
				resource,
				authorization_servers: [origin],
				scopes_supported: [...MCP_SCOPES],
				bearer_methods_supported: ["header"],
			});
		}
		if (pathname === MCP_PATH) return serveMcp(request);
		if (pathname === LOGIN_PATH) return login(request);
		if (pathname === CONSENT_PATH) return consent(request);
		if (pathname === DEVICE_PATH) return device(request);
		if (pathname === CONNECTED_APPS_PATH) return connectedApps(request);
		if (pathname.startsWith(ASSETS_PATH_PREFIX)) {
			return serveAsset(pageAssets, pathname);
		}
		return authRoutes.handle(request);
	};
};
