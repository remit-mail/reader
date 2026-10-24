/**
 * The MCP connector from outside (remit-mail/remit#1342): the `mcp` compose
 * profile switched the way `remit mcp enable` switches it, and the OAuth flow a
 * client such as Claude Code runs against it.
 *
 * Image stack only. The profile is a compose service of the packaged deployment,
 * and the stack is the one `npm run e2e:up` started from deploy/vps.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const deployDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"deploy",
	"vps",
);
const envFile = join(deployDir, ".env");

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** The connector's origin: a second loopback port on the same Caddy. */
export const mcpOrigin = (): string => {
	const port = process.env.E2E_MCP_PORT;
	if (!port) throw new Error("E2E_MCP_PORT is not set — run via `npm run e2e`");
	return `http://localhost:${port}`;
};

const compose = (...args: string[]): void => {
	execFileSync(
		"docker",
		[
			"compose",
			"--project-directory",
			deployDir,
			"-f",
			join(deployDir, "docker-compose.sqlite.yml"),
			"-f",
			join(deployDir, "docker-compose.dovecot.yml"),
			"-f",
			join(deployDir, "docker-compose.e2e.yml"),
			...args,
		],
		{ stdio: "inherit", timeout: 300_000 },
	);
};

/**
 * Turn the connector on: the origin Caddy routes and the profile that starts the
 * container, both in .env, then the same `up` a restart runs. Returns what puts
 * the stack back.
 */
export const enableMcpProfile = (origin: string): (() => void) => {
	const before = readFileSync(envFile, "utf8");
	writeFileSync(
		envFile,
		`${before}MCP_PUBLIC_ORIGIN=${origin}\nCOMPOSE_PROFILES=mcp\n`,
	);
	compose("up", "-d", "--wait", "--wait-timeout", "180");
	return () => {
		writeFileSync(envFile, before);
		compose("--profile", "mcp", "rm", "--force", "--stop", "mcp");
		compose("up", "-d", "--wait", "--wait-timeout", "180");
	};
};

/** One JSON-RPC request to /mcp, as a client with a token sends it. */
export const mcpRequest = async (
	origin: string,
	token: string,
	method: string,
	params: Record<string, unknown> = {},
): Promise<Response> =>
	fetch(`${origin}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});

/** Call one tool and parse the JSON its text content carries. */
export const callTool = async (
	origin: string,
	token: string,
	name: string,
	args: Record<string, unknown>,
): Promise<unknown> => {
	const response = await mcpRequest(origin, token, "tools/call", {
		name,
		arguments: args,
	});
	if (!response.ok) {
		throw new Error(
			`${name} answered ${response.status}: ${await response.text()}`,
		);
	}
	const rpc = (await response.json()) as {
		result?: { content?: { type: string; text: string }[]; isError?: boolean };
		error?: unknown;
	};
	const text = rpc.result?.content?.[0]?.text;
	if (rpc.error || rpc.result?.isError || text === undefined) {
		throw new Error(`${name} failed: ${JSON.stringify(rpc)}`);
	}
	return JSON.parse(text);
};

const cookiesOf = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");

const redirectOf = (response: Response, origin: string): URL => {
	const location = response.headers.get("location");
	if (response.status !== 302 || !location) {
		throw new Error(`expected a redirect, got ${response.status}`);
	}
	return new URL(location, origin);
};

/**
 * Dynamic registration, authorization code with PKCE, the login and consent
 * pages, and the token exchange — what a client runs on its first connect. The
 * callback is a loopback address the client would listen on; it is read from
 * the redirect and never dialled.
 */
export const connectAsClient = async (
	origin: string,
	credentials: { email: string; password: string },
	scope = "mail:read",
): Promise<string> => {
	const metadata = (await (
		await fetch(`${origin}/.well-known/oauth-authorization-server`)
	).json()) as {
		registration_endpoint: string;
		authorization_endpoint: string;
		token_endpoint: string;
	};
	const callback = "http://127.0.0.1:33418/callback";
	const registered = await fetch(metadata.registration_endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: "remit e2e",
			redirect_uris: [callback],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		}),
	});
	if (registered.status !== 201) {
		throw new Error(
			`registration answered ${registered.status}: ${await registered.text()}`,
		);
	}
	const { client_id: clientId } = (await registered.json()) as {
		client_id: string;
	};

	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	const resource = `${origin}/mcp`;
	const toLogin = redirectOf(
		await fetch(
			`${metadata.authorization_endpoint}?${new URLSearchParams({
				response_type: "code",
				client_id: clientId,
				redirect_uri: callback,
				scope,
				state: "e2e-state",
				code_challenge: challenge,
				code_challenge_method: "S256",
				resource,
			})}`,
			{ redirect: "manual" },
		),
		origin,
	);

	const form = (path: string, fields: Record<string, string>, cookie = "") =>
		fetch(`${origin}${path}`, {
			method: "POST",
			redirect: "manual",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin,
				cookie,
			},
			body: new URLSearchParams(fields),
		});

	const signedIn = await form("/login", {
		email: credentials.email,
		password: credentials.password,
		oauth_query: toLogin.search.slice(1),
	});
	const cookie = cookiesOf(signedIn);
	let next = redirectOf(signedIn, origin);
	if (next.pathname === "/consent") {
		next = redirectOf(
			await form(
				"/consent",
				{ accept: "true", oauth_query: next.search.slice(1) },
				cookie,
			),
			origin,
		);
	}
	const code = next.searchParams.get("code");
	if (`${next.origin}${next.pathname}` !== callback || !code) {
		throw new Error(`the flow ended at ${next} without a code`);
	}

	const exchanged = await fetch(metadata.token_endpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			code,
			redirect_uri: callback,
			code_verifier: verifier,
			resource,
		}),
	});
	const body = (await exchanged.json()) as { access_token?: string };
	if (!exchanged.ok || !body.access_token) {
		throw new Error(
			`token exchange answered ${exchanged.status}: ${JSON.stringify(body)}`,
		);
	}
	return body.access_token;
};

/**
 * RFC 8628, as `remit mcp login` runs it: a device-only client, a user code,
 * the signed-in approval on the device page, and the token poll.
 */
export const connectWithDeviceCode = async (
	origin: string,
	credentials: { email: string; password: string },
): Promise<string> => {
	const metadata = (await (
		await fetch(`${origin}/.well-known/oauth-authorization-server`)
	).json()) as {
		registration_endpoint: string;
		device_authorization_endpoint: string;
		token_endpoint: string;
	};
	const registered = await fetch(metadata.registration_endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: "remit e2e device",
			grant_types: [DEVICE_CODE_GRANT],
			token_endpoint_auth_method: "none",
		}),
	});
	if (registered.status !== 201) {
		throw new Error(
			`registration answered ${registered.status}: ${await registered.text()}`,
		);
	}
	const { client_id: clientId } = (await registered.json()) as {
		client_id: string;
	};
	const resource = `${origin}/mcp`;
	const authorized = await fetch(metadata.device_authorization_endpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			scope: "mail:read mail:rules",
			resource,
		}),
	});
	if (!authorized.ok) {
		throw new Error(
			`device authorization answered ${authorized.status}: ${await authorized.text()}`,
		);
	}
	const grant = (await authorized.json()) as {
		device_code: string;
		user_code: string;
		interval: number;
	};

	const devicePage = `/device?${new URLSearchParams({ user_code: grant.user_code })}`;
	const signedIn = await fetch(`${origin}/login`, {
		method: "POST",
		redirect: "manual",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			origin,
		},
		body: new URLSearchParams({
			email: credentials.email,
			password: credentials.password,
			return_to: devicePage,
		}),
	});
	const cookie = cookiesOf(signedIn);
	const returned = redirectOf(signedIn, origin);
	if (`${returned.pathname}${returned.search}` !== devicePage) {
		throw new Error(`sign-in returned to ${returned}, not the device page`);
	}
	const confirm = await fetch(`${origin}${devicePage}`, {
		headers: { cookie },
	});
	if (confirm.status !== 200) {
		throw new Error(`the device page answered ${confirm.status}`);
	}
	await confirm.body?.cancel();
	const approved = await fetch(`${origin}/device`, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			origin,
			cookie,
		},
		body: new URLSearchParams({
			user_code: grant.user_code,
			action: "approve",
		}),
	});
	const approvedPage = await approved.text();
	if (approved.status !== 200 || !approvedPage.includes("Device connected")) {
		throw new Error(`approval answered ${approved.status}`);
	}

	const poll = () =>
		fetch(metadata.token_endpoint, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: DEVICE_CODE_GRANT,
				device_code: grant.device_code,
				client_id: clientId,
				resource,
			}),
		});
	const deadline = Date.now() + 60_000;
	let intervalMs = grant.interval * 1000;
	while (Date.now() < deadline) {
		await setTimeout(intervalMs);
		const polled = await poll();
		const body = (await polled.json()) as {
			access_token?: string;
			error?: string;
		};
		if (polled.ok && body.access_token) return body.access_token;
		if (body.error === "slow_down") {
			intervalMs += 5_000;
			continue;
		}
		if (body.error !== "authorization_pending") {
			throw new Error(`the token poll answered ${JSON.stringify(body)}`);
		}
	}
	throw new Error("the device code was never exchanged for a token");
};
