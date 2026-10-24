import { CLIENT_IP_HEADER } from "@remit/auth-service";
import { extractBearerToken } from "@remit/auth-service/verifier";
import { z } from "zod";
import {
	AUTH_BASE_PATH,
	CONNECTED_APPS_API_PATH,
	CONNECTED_APPS_PATH,
	CONSENT_PATH,
	DEVICE_PATH,
	LOGIN_PATH,
	MCP_PATH,
	type McpAuthRoutes,
	mcpResource,
	REVOKE_CLIENT_API_PATH,
	SIGN_IN_PATH,
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
import { createMcpHandler } from "./server.js";

export interface McpAppConfig {
	origin: string;
	authRoutes: McpAuthRoutes;
	verifier: TokenVerifier;
	deps: McpDeps;
	trustedProxies: ReadonlySet<string>;
	pageAssets: PageAssets;
}

export type McpAppHandler = (
	request: Request,
	peerAddress: string | undefined,
) => Promise<Response>;

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

const FORWARDED_HEADERS = ["cookie", "origin", "user-agent", CLIENT_IP_HEADER];

const formString = (form: FormData, name: string): string => {
	const value = form.get(name);
	return typeof value === "string" ? value : "";
};

const redirectUrlOf = (body: unknown): string | undefined => {
	if (typeof body !== "object" || body === null) return undefined;
	const url = (body as { url?: unknown }).url;
	return typeof url === "string" ? url : undefined;
};

const messageOf = (body: unknown): string => {
	if (typeof body !== "object" || body === null) return "The request failed.";
	const { message, error_description } = body as {
		message?: unknown;
		error_description?: unknown;
	};
	if (typeof error_description === "string") return error_description;
	if (typeof message === "string") return message;
	return "The request failed.";
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
	trustedProxies,
	pageAssets,
}: McpAppConfig): McpAppHandler => {
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
	const withClientIp = (
		request: Request,
		peerAddress: string | undefined,
	): Request => {
		const forwarded = request.headers.get(CLIENT_IP_HEADER);
		const clientIp =
			forwarded && peerAddress && trustedProxies.has(peerAddress)
				? forwarded
				: peerAddress;
		const headers = new Headers(request.headers);
		headers.delete(CLIENT_IP_HEADER);
		if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp);
		return new Request(request, { headers });
	};

	const callAuth = (
		request: Request,
		path: string,
		body: Record<string, unknown>,
	): Promise<Response> => {
		const headers = new Headers({
			accept: "application/json",
			"content-type": "application/json",
		});
		for (const name of FORWARDED_HEADERS) {
			const value = request.headers.get(name);
			if (value !== null) headers.set(name, value);
		}
		return authRoutes.handle(
			new Request(`${origin}${AUTH_BASE_PATH}${path}`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			}),
		);
	};

	const continueFrom = async (response: Response): Promise<Response> => {
		const body: unknown = await response.json();
		const location = response.ok ? redirectUrlOf(body) : undefined;
		if (!location) {
			return errorPage(
				"Connecting failed",
				messageOf(body),
				"Go back to your MCP client and connect remit again.",
				response.status,
			);
		}
		return redirectWithCookies(location, response);
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
		const response = await callAuth(request, SIGN_IN_PATH, {
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
			const response = await authRoutes.handle(
				new Request(
					`${origin}${AUTH_BASE_PATH}/oauth2/public-client?${new URLSearchParams({ client_id: clientId })}`,
					{
						headers: {
							accept: "application/json",
							cookie: request.headers.get("cookie") ?? "",
						},
					},
				),
			);
			if (!response.ok) {
				await response.body?.cancel();
				return errorPage(
					"Connecting failed",
					"This sign-in request names an app remit does not know.",
					"Go back to your MCP client and connect remit again.",
					400,
				);
			}
			const client = (await response.json()) as { client_name?: unknown };
			return consentView(
				url.search.slice(1),
				typeof client.client_name === "string" ? client.client_name : clientId,
				scopes,
			);
		}
		const form = await request.formData();
		return continueFrom(
			await callAuth(request, "/oauth2/consent", {
				accept: formString(form, "accept") === "true",
				oauth_query: formString(form, "oauth_query"),
			}),
		);
	};

	const deviceUnavailable = (): Response =>
		errorPage(
			"Device sign-in is off",
			"This server does not accept device codes.",
			"Connect from Claude in the browser instead, or ask the person who runs this remit server to update it.",
			404,
		);

	const device = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (!(await authRoutes.hasSession(request))) {
			return toLogin(`${url.pathname}${url.search}`);
		}
		if (request.method === "GET") {
			const userCode = (url.searchParams.get("user_code") ?? "").trim();
			if (!userCode) return deviceView({ kind: "enter", userCode: "" });
			const response = await authRoutes.handle(
				new Request(
					`${origin}${AUTH_BASE_PATH}${DEVICE_PATH}?${new URLSearchParams({ user_code: userCode })}`,
					{
						headers: {
							accept: "application/json",
							cookie: request.headers.get("cookie") ?? "",
						},
					},
				),
			);
			await response.body?.cancel();
			if (response.status === 404) return deviceUnavailable();
			if (!response.ok) {
				return deviceView(
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
			}
			return deviceView({ kind: "confirm", userCode });
		}
		const form = await request.formData();
		const userCode = formString(form, "user_code");
		const approve = formString(form, "action") === "approve";
		const response = await callAuth(
			request,
			approve ? `${DEVICE_PATH}/approve` : `${DEVICE_PATH}/deny`,
			{ userCode },
		);
		if (response.status === 404) return deviceUnavailable();
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
						messageOf(await response.json()),
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
		const response = await authRoutes.handle(
			new Request(`${origin}${AUTH_BASE_PATH}${CONNECTED_APPS_API_PATH}`, {
				headers: {
					accept: "application/json",
					cookie: request.headers.get("cookie") ?? "",
				},
			}),
		);
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
		const response = await callAuth(request, REVOKE_CLIENT_API_PATH, {
			client_id: clientId,
		});
		if (response.status === 401) return toLogin(CONNECTED_APPS_PATH);
		if (!response.ok) {
			return connectedAppsView(
				before,
				response.status,
				undefined,
				pageError(
					`Disconnecting ${name} failed: ${messageOf(await response.json())}`,
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

	return async (incoming, peerAddress) => {
		const request = withClientIp(incoming, peerAddress);
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
