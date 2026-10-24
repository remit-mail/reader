export type AccessAuth =
	| {
			readonly kind: "ServiceToken";
			readonly clientId: string;
			readonly clientSecret: string;
	  }
	| { readonly kind: "UserToken" };

export type AuthChoice =
	| { readonly ok: true; readonly auth: AccessAuth }
	| { readonly ok: false; readonly message: string };

export type TokenRun =
	| { readonly kind: "Missing" }
	| { readonly kind: "Ran"; readonly stdout: string };

export type HeadersResult =
	| { readonly ok: true; readonly headers: Readonly<Record<string, string>> }
	| { readonly ok: false; readonly message: string };

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const selectAuth = (
	env: Readonly<Record<string, string | undefined>>,
): AuthChoice => {
	const clientId = env.CF_ACCESS_CLIENT_ID ?? "";
	const clientSecret = env.CF_ACCESS_CLIENT_SECRET ?? "";
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
	return { ok: true, auth: { kind: "UserToken" } };
};

export const loginCommand = (appUrl: string): string =>
	`cloudflared access login ${appUrl}`;

export const accessHeaders = (
	auth: AccessAuth,
	appUrl: string,
	runCloudflared: (appUrl: string) => TokenRun,
): HeadersResult => {
	if (auth.kind === "ServiceToken") {
		return {
			ok: true,
			headers: {
				"CF-Access-Client-Id": auth.clientId,
				"CF-Access-Client-Secret": auth.clientSecret,
			},
		};
	}
	const run = runCloudflared(appUrl);
	if (run.kind === "Missing") {
		return {
			ok: false,
			message: `cloudflared is not installed: install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and run '${loginCommand(appUrl)}', or set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET`,
		};
	}
	const token = run.stdout.trim();
	if (!JWT.test(token)) {
		return {
			ok: false,
			message: `cloudflared has no Access token for ${appUrl}: run '${loginCommand(appUrl)}'`,
		};
	}
	return { ok: true, headers: { "cf-access-token": token } };
};
