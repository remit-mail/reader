import { ApiClient, signIn, signUp } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { provisionIsolatedRun } from "../src/provision.js";

const tokenStatus = async (cookie: string): Promise<number> =>
	(await fetch(`${baseUrl}/api/auth/token`, { headers: { cookie } })).status;

const signInStatus = async (email: string, password: string): Promise<number> =>
	(
		await fetch(`${baseUrl}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseUrl },
			body: JSON.stringify({ email, password }),
		})
	).status;

test.describe("Delete-me on self-host (#1486)", () => {
	test("erases the login user and refuses its session", async () => {
		test.setTimeout(180_000);
		const run = await provisionIsolatedRun("E2E Delete Me Auth");
		const cookie = await signIn(run);
		expect(await tokenStatus(cookie)).toBe(200);

		const response = await new ApiClient(run).request("DELETE", "/me", {
			confirmEmail: run.email,
		});
		expect(response.status).toBe(202);

		await expect
			.poll(() => tokenStatus(cookie), { timeout: 120_000 })
			.toBe(401);
		expect(await signInStatus(run.email, run.password)).toBe(401);
		await signUp({ email: run.email, password: run.password, name: "Again" });
	});
});
