import { CLIENT_IP_HEADER } from "@remit/auth-service";
import { extractBearerToken } from "@remit/auth-service/verifier";
import { APIError } from "better-auth/api";
import {
	AUTH_BASE_PATH,
	authServerMetadataHandler,
	CONSENT_PATH,
	LOGIN_PATH,
	MCP_PATH,
	type McpAuth,
	mcpResource,
	SIGN_IN_PATH,
} from "./auth/authorization-server.js";
import { consentPage, errorPage, loginPage } from "./auth/pages.js";
import { MCP_SCOPES } from "./auth/scopes.js";
import type { TokenVerifier } from "./auth/token-verifier.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler, type McpRequestHandler } from "./server.js";

export interface McpAppConfig {
	origin: string;
	auth: McpAuth;
	verifier: TokenVerifier;
	deps: McpDeps;
}

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

const redirectWithCookies = (location: string, from: Response): Response => {
	const headers = new Headers({ location, "cache-control": "no-store" });
	for (const cookie of from.headers.getSetCookie()) {
		headers.append("set-cookie", cookie);
	}
	return new Response(null, { status: 302, headers });
};

export const createMcpApp = ({
	origin,
	auth,
	verifier,
	deps,
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
	const authServerMetadata = authServerMetadataHandler(auth);

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
		return auth.handler(
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
			const client = await auth.api
				.getOAuthClientPublic({
					query: { client_id: clientId },
					headers: request.headers,
				})
				.catch((error: unknown) => {
					if (error instanceof APIError) return undefined;
					throw error;
				});
			if (!client) {
				return errorPage("Sign in again from your MCP client.", 400);
			}
			return consentPage(
				url.search.slice(1),
				client.client_name ?? clientId,
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
			return authServerMetadata(request);
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
		if (pathname.startsWith(`${AUTH_BASE_PATH}/`)) return auth.handler(request);
		return new Response("Not found", { status: 404 });
	};
};
