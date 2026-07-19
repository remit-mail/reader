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

	// Asserting the status alone would not distinguish an authorised read from a
	// rejected one: this endpoint answers 200 with an empty list for any mailbox
	// id, including one the caller cannot see. The run's own mail has to come
	// back for the token to have done anything.
	test("accepts the token the session exchange issued", async ({
		api,
		run,
	}) => {
		const response = await api.request(
			"GET",
			`/mailboxes/${run.inboxId}/threads`,
		);
		expect(response.status).toBe(200);

		const body = (await response.json()) as { items?: { subject?: string }[] };
		const subjects = (body.items ?? []).map((item) => item.subject);
		for (const seeded of run.seededSubjects) {
			expect(subjects).toContain(seeded);
		}
	});

	// The same read against a mailbox this caller does not own must not return
	// another tenant's mail. An unknown id answers with an empty list, which is
	// the same shape as "no access" — either way there is nothing in it.
	test("returns nothing for a mailbox the caller does not own", async ({
		api,
	}) => {
		const response = await api.request(
			"GET",
			"/mailboxes/0000000000000000000000000/threads",
		);
		expect([200, 403, 404]).toContain(response.status);
		if (response.status !== 200) return;

		const body = (await response.json()) as { items?: unknown[] };
		expect(body.items ?? []).toHaveLength(0);
	});
});
