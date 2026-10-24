const escapeHtml = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const page = (title: string, body: string, status = 200): Response =>
	new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
		{
			status,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"x-frame-options": "DENY",
				"content-security-policy": "default-src 'none'; frame-ancestors 'none'",
			},
		},
	);

export const loginPage = (
	oauthQuery: string,
	error: string | undefined,
	status = 200,
): Response =>
	page(
		"Sign in to remit",
		`${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<form method="post"><input type="hidden" name="oauth_query" value="${escapeHtml(oauthQuery)}"><label>Email <input type="email" name="email" autocomplete="username" required></label><label>Password <input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form>`,
		status,
	);

export const consentPage = (
	oauthQuery: string,
	clientName: string,
	scopes: readonly string[],
): Response =>
	page(
		"Allow access to your mail",
		`<p>${escapeHtml(clientName)} asks for:</p><ul>${scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("")}</ul><form method="post"><input type="hidden" name="oauth_query" value="${escapeHtml(oauthQuery)}"><button type="submit" name="accept" value="true">Allow</button><button type="submit" name="accept" value="false">Deny</button></form>`,
	);

export const errorPage = (message: string, status: number): Response =>
	page("Something went wrong", `<p>${escapeHtml(message)}</p>`, status);
