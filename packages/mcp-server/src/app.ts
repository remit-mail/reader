import { CLIENT_IP_HEADER } from "@remit/auth-service";
import { extractBearerToken } from "@remit/auth-service/verifier";
import {
	AUTH_BASE_PATH,
	CONSENT_PATH,
	DEVICE_APPROVE_PATH,
	DEVICE_DENY_PATH,
	DEVICE_PATH,
	DEVICE_VERIFY_PATH,
	LOGIN_PATH,
	MCP_PATH,
	type McpAuthRoutes,
	mcpResource,
	SIGN_IN_PATH,
} from "./auth/authorization-server.js";
import {
	consentPage,
	deviceDonePage,
	devicePage,
	errorPage,
	loginPage,
} from "./auth/pages.js";
import { MCP_SCOPES } from "./auth/scopes.js";
import type { TokenVerifier } from "./auth/token-verifier.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler } from "./server.js";

export interface McpAppConfig {
	origin: string;
	authRoutes: McpAuthRoutes;
	verifier: TokenVerifier;
	deps: McpDeps;
	trustedProxies: ReadonlySet<string>;
}

export type McpAppHandler = (
	request: Request,
	peerAddress: string | undefined,
) => Promise<Response>;

const PROTECTED_RESOURCE_METADATA_PATH =
	"/.well-known/oauth-protected-resource";

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

const cookieHeaderOf = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");

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

	const forwardedHeaders = (request: Request): Headers => {
		const headers = new Headers({
			accept: "application/json",
			"content-type": "application/json",
		});
		for (const name of FORWARDED_HEADERS) {
			const value = request.headers.get(name);
			if (value !== null) headers.set(name, value);
		}
		return headers;
	};

	const callAuth = (
		request: Request,
		path: string,
		body: Record<string, unknown>,
	): Promise<Response> => {
		const headers = forwardedHeaders(request);
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
		if (!location) return errorPage(messageOf(body), response.status);
		return redirectWithCookies(location, response);
	};

	const login = async (request: Request): Promise<Response> => {
		if (request.method === "GET") {
			const oauthQuery = new URL(request.url).search.slice(1);
			if (!oauthQuery) {
				return errorPage("Start signing in from your MCP client.", 400);
			}
			return loginPage(oauthQuery, undefined);
		}
		const form = await request.formData();
		const oauthQuery = formString(form, "oauth_query");
		const response = await callAuth(request, SIGN_IN_PATH, {
			email: formString(form, "email"),
			password: formString(form, "password"),
			oauth_query: oauthQuery,
		});
		if (response.status === 401) {
			return loginPage(oauthQuery, "Wrong email or password.", 401);
		}
		if (response.status === 429) {
			return loginPage(oauthQuery, "Too many attempts. Wait a minute.", 429);
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
				return errorPage("Sign in again from your MCP client.", 400);
			}
			const client = (await response.json()) as { client_name?: unknown };
			return consentPage(
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

	const device = async (request: Request): Promise<Response> => {
		if (request.method === "GET") {
			const userCode = new URL(request.url).searchParams.get("user_code");
			return devicePage(userCode ?? "", undefined);
		}
		const form = await request.formData();
		const userCode = formString(form, "user_code").trim();
		const approve = formString(form, "action") === "approve";
		const signedIn = await callAuth(request, SIGN_IN_PATH, {
			email: formString(form, "email"),
			password: formString(form, "password"),
			oauth_query: "",
		});
		if (signedIn.status === 401) {
			return devicePage(userCode, "Wrong email or password.", 401);
		}
		if (signedIn.status === 429) {
			return devicePage(userCode, "Too many attempts. Wait a minute.", 429);
		}
		if (!signedIn.ok) {
			return errorPage(messageOf(await signedIn.json()), signedIn.status);
		}
		const headers = forwardedHeaders(request);
		headers.set("cookie", cookieHeaderOf(signedIn));
		const claimed = await authRoutes.handle(
			new Request(
				`${origin}${AUTH_BASE_PATH}${DEVICE_VERIFY_PATH}?${new URLSearchParams({ user_code: userCode })}`,
				{ headers },
			),
		);
		if (!claimed.ok) {
			return devicePage(userCode, messageOf(await claimed.json()), 400);
		}
		const decided = await authRoutes.handle(
			new Request(
				`${origin}${AUTH_BASE_PATH}${approve ? DEVICE_APPROVE_PATH : DEVICE_DENY_PATH}`,
				{ method: "POST", headers, body: JSON.stringify({ userCode }) },
			),
		);
		if (!decided.ok) {
			return devicePage(
				userCode,
				messageOf(await decided.json()),
				decided.status,
			);
		}
		return deviceDonePage(approve);
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
		return authRoutes.handle(request);
	};
};
