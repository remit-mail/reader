import type { Target, TargetKind } from "./target.ts";

export type Auth =
	| {
			readonly kind: "ServiceToken";
			readonly clientId: string;
			readonly clientSecret: string;
	  }
	| { readonly kind: "AccessUserToken" }
	| { readonly kind: "Bearer"; readonly token: string }
	| {
			readonly kind: "Password";
			readonly email: string;
			readonly password: string;
	  };

export type AuthChoice =
	| { readonly ok: true; readonly auth: Auth }
	| { readonly ok: false; readonly message: string };

export type TokenRun =
	| { readonly kind: "Missing" }
	| { readonly kind: "Ran"; readonly stdout: string };

export type SignIn =
	| { readonly ok: true; readonly token: string }
	| { readonly ok: false; readonly message: string };

export interface AuthIo {
	readonly runCloudflared: (origin: string) => TokenRun;
	readonly signIn: (
		target: Target,
		email: string,
		password: string,
	) => Promise<SignIn>;
}

export type HeadersResult =
	| { readonly ok: true; readonly headers: Readonly<Record<string, string>> }
	| { readonly ok: false; readonly message: string };

type Env = Readonly<Record<string, string | undefined>>;

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const STANDALONE_FIX =
	"set REMIT_EMAIL and REMIT_PASSWORD to the account you sign in to the app with, or REMIT_TOKEN to a JWT from /api/auth/token";

const set = (value: string | undefined): string =>
	value === undefined ? "" : value;

const cloudflareAuth = (env: Env): AuthChoice => {
	const clientId = set(env.CF_ACCESS_CLIENT_ID);
	const clientSecret = set(env.CF_ACCESS_CLIENT_SECRET);
	if (clientId !== "" && clientSecret !== "") {
		return { ok: true, auth: { kind: "ServiceToken", clientId, clientSecret } };
	}
	if (clientId !== "" || clientSecret !== "") {
		return {
			ok: false,
			message:
				"CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET go together: set both for a service token, or neither to use cloudflared",
		};
	}
	return { ok: true, auth: { kind: "AccessUserToken" } };
};

const standaloneAuth = (env: Env): AuthChoice => {
	const token = set(env.REMIT_TOKEN);
	if (token !== "") return { ok: true, auth: { kind: "Bearer", token } };
	const email = set(env.REMIT_EMAIL);
	const password = set(env.REMIT_PASSWORD);
	if (email !== "" && password !== "") {
		return { ok: true, auth: { kind: "Password", email, password } };
	}
	return {
		ok: false,
		message: `the standalone target needs a sign-in: ${STANDALONE_FIX}`,
	};
};

export const selectAuth = (kind: TargetKind, env: Env): AuthChoice =>
	kind === "cloudflare" ? cloudflareAuth(env) : standaloneAuth(env);

export const loginCommand = (origin: string): string =>
	`cloudflared access login ${origin}`;

export const refusalFix = (auth: Auth, target: Target): string => {
	if (auth.kind === "ServiceToken") {
		return "check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET against the Access policy";
	}
	if (auth.kind === "AccessUserToken") {
		return `run '${loginCommand(target.origin)}'`;
	}
	return STANDALONE_FIX;
};

const accessUserHeaders = (
	origin: string,
	runCloudflared: AuthIo["runCloudflared"],
): HeadersResult => {
	const run = runCloudflared(origin);
	if (run.kind === "Missing") {
		return {
			ok: false,
			message: `cloudflared is not installed: install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and run '${loginCommand(origin)}', or set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET`,
		};
	}
	const token = run.stdout.trim();
	if (!JWT.test(token)) {
		return {
			ok: false,
			message: `cloudflared has no Access token for ${origin}: run '${loginCommand(origin)}'`,
		};
	}
	return { ok: true, headers: { "cf-access-token": token } };
};

export const authHeaders = async (
	auth: Auth,
	target: Target,
	io: AuthIo,
): Promise<HeadersResult> => {
	switch (auth.kind) {
		case "ServiceToken":
			return {
				ok: true,
				headers: {
					"CF-Access-Client-Id": auth.clientId,
					"CF-Access-Client-Secret": auth.clientSecret,
				},
			};
		case "AccessUserToken":
			return accessUserHeaders(target.origin, io.runCloudflared);
		case "Bearer":
			return { ok: true, headers: { Authorization: `Bearer ${auth.token}` } };
		case "Password": {
			const signedIn = await io.signIn(target, auth.email, auth.password);
			if (!signedIn.ok) return signedIn;
			return {
				ok: true,
				headers: { Authorization: `Bearer ${signedIn.token}` },
			};
		}
	}
};
