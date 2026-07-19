/**
 * The gateway is the deployment's only defence in front of the API: if it stops
 * demanding a token, every other guarantee in this suite is decoration.
 */
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";

test.describe("API gateway", () => {
	test("rejects an unauthenticated business request", async ({ run }) => {
		const response = await fetch(
			`${baseUrl}/api/mailboxes/${run.inboxId}/threads`,
		);
		expect(response.status).toBe(401);
	});

	test("rejects a forged bearer token", async ({ run }) => {
		const response = await fetch(
			`${baseUrl}/api/mailboxes/${run.inboxId}/threads`,
			{ headers: { authorization: "Bearer not-a-real-token" } },
		);
		expect(response.status).toBe(401);
	});

	test("accepts the token the session exchange issued", async ({
		api,
		run,
	}) => {
		const response = await api.request(
			"GET",
			`/mailboxes/${run.inboxId}/threads`,
		);
		expect(response.status).toBe(200);
	});
});
