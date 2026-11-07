import { fetchBearerToken, signIn, signUp } from "../src/api.js";
import { baseUrl, peopleApiUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { peopleApiOnly } from "../src/stack.js";

const PASSWORD = "people e2e passphrase one";
const NEW_PASSWORD = "people e2e passphrase two";

const mintEmail = (role: string): string =>
	`people-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@remit.test`;

const tokenStatus = async (cookie: string): Promise<number> =>
	(await fetch(`${baseUrl}/api/auth/token`, { headers: { cookie } })).status;

const redeem = (token: string): Promise<Response> =>
	fetch(`${baseUrl}/api/auth/reset-password`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: baseUrl },
		body: JSON.stringify({ token, newPassword: NEW_PASSWORD }),
	});

test.describe("People operations on self-host (#1519)", () => {
	peopleApiOnly("the People operations answer only with self sign-up closed");

	test("a reset link works once, sign-out stops the token mint, and a foreign origin is refused", async () => {
		const operator = { email: mintEmail("operator"), password: PASSWORD };
		const target = { email: mintEmail("target"), password: PASSWORD };
		const bearer = await fetchBearerToken(
			await signUp({ ...operator, name: "Operator" }),
		);
		await signUp({ ...target, name: "Target" });

		const people = (
			method: string,
			path: string,
			body?: unknown,
			origin = baseUrl,
		): Promise<Response> =>
			fetch(`${peopleApiUrl}/people${path}`, {
				method,
				headers: {
					authorization: `Bearer ${bearer}`,
					"content-type": "application/json",
					origin,
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			});

		const listed = await people("GET", "");
		expect(listed.status).toBe(200);
		const { people: everyone } = (await listed.json()) as {
			people: Array<{ userId: string; email: string }>;
		};
		const targetId = everyone.find(
			(person) => person.email === target.email,
		)?.userId;
		expect(targetId).toBeTruthy();

		const stepUp = async (action: string): Promise<string> => {
			const granted = await people("POST", "/step-up", {
				password: operator.password,
				action,
				userId: targetId,
			});
			expect(granted.status).toBe(200);
			return ((await granted.json()) as { stepUpToken: string }).stepUpToken;
		};

		const issued = await people("POST", `/${targetId}/password-reset`, {
			stepUpToken: await stepUp("ResetPassword"),
		});
		expect(issued.status).toBe(200);
		const { resetUrl } = (await issued.json()) as { resetUrl: string };
		const token = resetUrl.split("/").at(-1) ?? "";
		expect((await redeem(token)).status).toBe(200);
		expect((await redeem(token)).status).toBe(400);

		const cookie = await signIn({
			email: target.email,
			password: NEW_PASSWORD,
		});
		expect(await tokenStatus(cookie)).toBe(200);
		const signedOut = await people("POST", `/${targetId}/sign-out`, {
			stepUpToken: await stepUp("SignOut"),
		});
		expect(signedOut.status).toBe(200);
		expect(await tokenStatus(cookie)).toBe(401);

		const foreign = await people(
			"POST",
			`/${targetId}/sign-out`,
			{ stepUpToken: await stepUp("SignOut") },
			"https://evil.example",
		);
		expect(foreign.status).toBe(403);
		expect(((await foreign.json()) as { code: string }).code).toBe(
			"foreign_origin",
		);
	});
});
