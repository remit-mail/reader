import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const REFRESH_PREFIX = "fake-refresh.";

const base64url = (value) => Buffer.from(value).toString("base64url");

const idToken = (email) =>
	`${base64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64url(JSON.stringify({ preferred_username: email, email }))}.unsigned`;

const readConsent = (code) => {
	const consent = JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
	if (typeof consent.scope !== "string" || typeof consent.email !== "string") {
		throw new Error("the code names no scope or email");
	}
	return consent;
};

const tokens = (code, consent, scope) => ({
	token_type: "Bearer",
	expires_in: 3600,
	access_token: `fake-access.${code}`,
	refresh_token: `${REFRESH_PREFIX}${code}`,
	id_token: idToken(consent.email),
	scope,
});

const answer = (form) => {
	const grant = form.get("grant_type");
	if (grant === "authorization_code") {
		const code = form.get("code") ?? "";
		const consent = readConsent(code);
		return [200, tokens(code, consent, consent.scope)];
	}
	if (grant === "refresh_token") {
		const refresh = form.get("refresh_token") ?? "";
		const code = refresh.slice(REFRESH_PREFIX.length);
		const consent = readConsent(code);
		const consented = new Set(consent.scope.split(" "));
		const requested = (form.get("scope") ?? "")
			.split(" ")
			.filter((scope) => scope.includes("://"));
		const missing = requested.filter((scope) => !consented.has(scope));
		if (missing.length > 0) {
			return [
				400,
				{
					error: "invalid_grant",
					error_description: `AADSTS65001: The user has not consented to ${missing.join(" ")}.`,
				},
			];
		}
		return [200, tokens(code, consent, requested.join(" "))];
	}
	return [400, { error: "unsupported_grant_type" }];
};

createServer((request, response) => {
	if (request.method === "GET" && request.url === "/health") {
		response.writeHead(200).end("ok");
		return;
	}
	if (request.method !== "POST" || request.url !== "/token") {
		response.writeHead(404).end();
		return;
	}
	let body = "";
	request.on("data", (chunk) => {
		body += chunk;
	});
	request.on("end", () => {
		Promise.resolve(body)
			.then((form) => answer(new URLSearchParams(form)))
			.catch((error) => [
				400,
				{ error: "invalid_grant", error_description: String(error) },
			])
			.then(([status, payload]) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(payload));
			});
	});
}).listen(PORT, "0.0.0.0");
