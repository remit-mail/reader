/**
 * Review-and-rescue: getting a message out of Spam has to work, and the sender
 * behind it has to be resolvable.
 *
 * Both halves regressed at once (issues #51 and #55). Address search matched a
 * prefix of `"<display name> <email>"`, so looking a sender up by their address
 * never found the row and every per-sender quick action reported an impossible
 * state. Separately, moving mail out of Spam threw inside the optimistic cache
 * update — the rescue-candidate query caches a different shape under the same
 * query-key prefix as the mailbox list — so the move failed before it was ever
 * sent, and said so in a toast.
 *
 * This spec drives both from outside: the API for the lookup, a browser for the
 * move.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { readRunState } from "../src/state.js";

const SENDER_NAME = "npm support";
const SENDER_EMAIL = "support@npmjs.com";
const SUBJECT = `Rescue me ${Date.now()}`;

/**
 * Put one message in Spam from a sender who has a display name — the ordinary
 * case, and the one address search used to miss. Worker-scoped, so it reads the
 * run state directly rather than through the per-test fixtures.
 */
test.beforeAll(async () => {
	const run = readRunState();
	const api = new ApiClient(run.token);

	await appendMessages(
		run.imapUser,
		[
			{
				subject: SUBJECT,
				from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
				body: "This one does not belong in Spam.",
			},
		],
		"Junk",
	);
	await api.triggerSync(run.accountId);
});

const junkMailboxId = async (
	api: ApiClient,
	accountId: string,
): Promise<string> => {
	const mailboxes = await waitFor(
		() => api.listMailboxes(accountId),
		(list) => list.some((mailbox) => mailbox.fullPath === "Junk"),
		{ timeoutMs: 60_000, what: "the Junk mailbox to sync" },
	);
	const junk = mailboxes.find((mailbox) => mailbox.fullPath === "Junk");
	if (!junk) throw new Error("unreachable: Junk was matched but not found");
	return junk.mailboxId;
};

const waitForSpamMessage = async (api: ApiClient, mailboxId: string) =>
	waitFor(
		() => api.listThreads(mailboxId),
		(items) => items.some((thread) => thread.subject === SUBJECT),
		{ timeoutMs: 60_000, what: `"${SUBJECT}" to sync into Junk` },
	);

test.describe("Spam rescue", () => {
	test("a sender with a display name is resolvable by their address", async ({
		api,
		run,
	}) => {
		const junkId = await junkMailboxId(api, run.accountId);
		await waitForSpamMessage(api, junkId);

		// Sync writes the address row as a side effect of storing the message, so
		// once the message is readable the row exists. Searching by the exact
		// address must return it: the sender's flags, and every quick action that
		// writes them, hang off this lookup.
		const addresses = await waitFor(
			() => api.searchAddresses(SENDER_EMAIL),
			(items) =>
				items.some((address) => address.normalizedEmail === SENDER_EMAIL),
			{ timeoutMs: 30_000, what: `the address record for ${SENDER_EMAIL}` },
		);

		expect(addresses.map((address) => address.normalizedEmail)).toContain(
			SENDER_EMAIL,
		);
	});

	test("moving a message out of Spam completes without an error", async ({
		api,
		page,
		run,
	}) => {
		const junkId = await junkMailboxId(api, run.accountId);
		await waitForSpamMessage(api, junkId);

		await page.goto(`/mail/${junkId}`);
		const row = page.getByText(SUBJECT, { exact: true }).first();
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 20_000 });

		await article
			.getByRole("button", { name: "Move this message", exact: true })
			.click();
		await page
			.getByRole("option", { name: "Move to Inbox", exact: true })
			.click();

		// The failure this spec exists for was loud in exactly two places: an
		// error banner, and the full-screen fatal page. Neither may appear.
		await expect(page.getByTestId("fatal-error-overlay")).toHaveCount(0);
		await expect(page.getByRole("alert")).toHaveCount(0);

		// And the move has to have actually happened, not merely not-failed.
		await expect(page.getByText(SUBJECT, { exact: true })).toHaveCount(0, {
			timeout: 20_000,
		});
		const remaining = await waitFor(
			() => api.listThreads(junkId),
			(items) => items.every((thread) => thread.subject !== SUBJECT),
			{ timeoutMs: 30_000, what: `"${SUBJECT}" to leave Junk` },
		);
		expect(remaining.map((thread) => thread.subject)).not.toContain(SUBJECT);
	});
});
