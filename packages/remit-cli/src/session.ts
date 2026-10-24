import type { SignIn } from "./auth.ts";
import type { Target } from "./target.ts";

const isToken = (value: unknown): value is { token: string } =>
	typeof value === "object" &&
	value !== null &&
	"token" in value &&
	typeof value.token === "string";

export const signIn = async (
	target: Target,
	email: string,
	password: string,
): Promise<SignIn> => {
	const authUrl = `${target.origin}/api/auth`;
	const session = await fetch(`${authUrl}/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
		redirect: "manual",
	});
	if (!session.ok) {
		return {
			ok: false,
			message: `sign-in as ${email} was refused (${session.status}): check REMIT_EMAIL and REMIT_PASSWORD`,
		};
	}
	const cookie = session.headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
	const minted = await fetch(`${authUrl}/token`, {
		headers: { cookie },
		redirect: "manual",
	});
	const body: unknown = minted.ok ? await minted.json() : undefined;
	if (!isToken(body)) {
		return {
			ok: false,
			message: `${authUrl}/token answered ${minted.status} without a token after signing in as ${email}`,
		};
	}
	return { ok: true, token: body.token };
};
