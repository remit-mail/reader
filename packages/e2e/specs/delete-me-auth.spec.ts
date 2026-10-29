import { ApiClient, fetchBearerToken, signIn, signUp } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { provisionIsolatedRun } from "../src/provision.js";

const outcome = (attempt: Promise<unknown>): Promise<string> =>
	attempt.then(
		() => "accepted",
		() => "refused",
	);

test.describe("Delete-me on self-host (#1486)", () => {
	test("erases the login user and refuses its session", async () => {
		test.setTimeout(180_000);
		const run = await provisionIsolatedRun("E2E Delete Me Auth");
		const cookie = await signIn(run);

		const response = await new ApiClient(run).request("DELETE", "/me", {
			confirmEmail: run.email,
		});
		expect(response.status).toBe(202);

		await expect
			.poll(() => outcome(fetchBearerToken(cookie)), { timeout: 120_000 })
			.toBe("refused");
		expect(await outcome(signIn(run))).toBe("refused");
		expect(
			await outcome(
				signUp({ email: run.email, password: run.password, name: "Again" }),
			),
		).toBe("accepted");
	});
});
