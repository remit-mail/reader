/**
 * Connecting a mailbox is the first thing a new operator does, and the first
 * thing that can be wrong: credentials, host resolution from inside the
 * container network, and TLS settings all meet here.
 */
import { imap, imapFromStack } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";

const connection = {
	username: imap.user,
	imapHost: imapFromStack.host,
	imapPort: imapFromStack.port,
	imapTls: false,
	imapStartTls: false,
};

test.describe("Account connection", () => {
	test("reports success for valid IMAP credentials", async ({ api }) => {
		const result = await api.testConnection({
			...connection,
			password: imap.password,
		});
		expect(result.imapSuccess).toBe(true);
	});

	test("reports failure for a wrong password rather than succeeding", async ({
		api,
	}) => {
		const result = await api.testConnection({
			...connection,
			password: "definitely-not-the-password",
		});
		expect(result.imapSuccess).toBe(false);
		expect(result.imapError).toBeTruthy();
	});

	test("the created account is the one the run syncs from", async ({
		api,
		run,
	}) => {
		const mailboxes = await api.listMailboxes(run.accountId);
		expect(mailboxes.length).toBeGreaterThan(0);
	});
});
