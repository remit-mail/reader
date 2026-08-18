/**
 * Review-and-rescue: getting a message out of Spam has to work, and the sender
 * behind it has to be resolvable.
 *
 * Both halves regressed at once (issues #51 and #55). Address search matched a
 * prefix of `"<display name> <email>"` — it matches a substring of the display
 * name, the local part, the domain or the whole address now (#704) — so looking a
 * sender up by their address never found the row and every per-sender quick
 * action reported an impossible state. Separately, moving mail
 * out of Spam threw inside the optimistic cache
 * update — the rescue-candidate query caches a different shape under the same
 * query-key prefix as the mailbox list — so the move failed before it was ever
 * sent, and said so in a toast.
 *
 * The Junk message is seeded in global setup, before the account is connected.
 * Appending it here and triggering a sync would ride the path `sync.spec.ts`
 * pins as known-failing, and this spec would then fail for that reason instead
 * of its own.
 *
 * Both halves are driven from outside: the API for the lookup, a browser for
 * the move. The move leaves the suite's shared mailbox in a state no other spec
 * expects, so it is undone in `afterAll`.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { waitForServerMailbox } from "../src/imap.js";
import { readRunState } from "../src/state.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

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

const waitForSpamMessage = async (
	api: ApiClient,
	mailboxId: string,
	subject: string,
) =>
	waitFor(
		() => api.listThreads(mailboxId),
		(items) => items.some((thread) => thread.subject === subject),
		{ timeoutMs: 60_000, what: `"${subject}" to sync into Junk` },
	);

test.describe("Spam rescue", () => {
	// The rescue is the only mutation in the suite that moves a seeded message
	// between folders. Every later spec that asserts the inbox holds exactly the
	// seeded set would read the rescued message as an extra row (#82), so this
	// puts it back. It runs whether or not the test reached its assertions, and
	// does nothing when the message never left Junk.
	test.afterAll(async () => {
		// Two server round trips, each of which the app answers before it makes.
		test.setTimeout(180_000);

		const run = readRunState();
		const api = new ApiClient(run);
		const junkId = await junkMailboxId(api, run.accountId);

		const inbox = await api.listThreads(run.inboxId);
		const rescued = inbox.filter(
			(thread) => thread.subject === run.spamSubject,
		);
		if (rescued.length === 0) return;

		// The rescue's own IMAP push can still be queued at this point: the read
		// model read above is updated the moment a move is accepted, the write to
		// the server follows. A move issued now would name the UID the message
		// still has in Junk and the folder it is not in yet, and the server would
		// drop it — so the rescue has to land first.
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => subjects.includes(run.spamSubject),
			{ what: `the rescue of "${run.spamSubject}" to reach the inbox` },
		);

		await api.moveMessages(
			rescued.map((thread) => thread.messageId),
			junkId,
		);

		// INBOX is re-derived from the server on every sync, so this is what the
		// next spec actually reads — and it is the opposite of the state waited
		// for above, which is what makes it an observation of this move.
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => !subjects.includes(run.spamSubject),
			{ what: `"${run.spamSubject}" to leave the inbox` },
		);
	});

	test("a sender with a display name is resolvable by their address", async ({
		api,
		run,
	}) => {
		const junkId = await junkMailboxId(api, run.accountId);
		await waitForSpamMessage(api, junkId, run.spamSubject);

		// Sync writes the address row as a side effect of storing the message, so
		// once the message is readable the row exists. Searching by the exact
		// address must return it: the sender's flags, and every quick action that
		// writes them, hang off this lookup.
		const addresses = await waitFor(
			() => api.searchAddresses(run.spamSenderEmail),
			(items) =>
				items.some(
					(address) => address.normalizedEmail === run.spamSenderEmail,
				),
			{
				timeoutMs: 30_000,
				what: `the address record for ${run.spamSenderEmail}`,
			},
		);

		expect(addresses.map((address) => address.normalizedEmail)).toContain(
			run.spamSenderEmail,
		);
	});

	/**
	 * The other half of what that lookup answers. A sender the account has only
	 * ever met in Spam is not a contact, and offering it back on a fragment is
	 * how the spoofed display name of #826 reached a compose field (#822). The
	 * exact-address resolution above and this are the same endpoint, and both
	 * have to hold at once — so this runs before the rescue, while the seeded
	 * message still lives nowhere but Junk.
	 */
	test("a sender only ever seen in Spam is not suggested on a fragment", async ({
		api,
		run,
	}) => {
		const junkId = await junkMailboxId(api, run.accountId);
		await waitForSpamMessage(api, junkId, run.spamSubject);
		await waitFor(
			() => api.searchAddresses(run.spamSenderEmail),
			(items) =>
				items.some(
					(address) => address.normalizedEmail === run.spamSenderEmail,
				),
			{
				timeoutMs: 30_000,
				what: `the address record for ${run.spamSenderEmail}`,
			},
		);

		const [localPart] = run.spamSenderEmail.split("@");
		const suggestions = await api.searchAddresses(localPart);

		expect(suggestions.map((address) => address.normalizedEmail)).not.toContain(
			run.spamSenderEmail,
		);
	});

	test("moving a message out of Spam completes without an error", async ({
		api,
		page,
		run,
	}) => {
		const junkId = await junkMailboxId(api, run.accountId);
		await waitForSpamMessage(api, junkId, run.spamSubject);

		await page.goto(`/mail/${junkId}`);
		const row = page.getByText(run.spamSubject, { exact: true }).first();
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.click();
		await page.waitForURL(MAILBOX_THREAD_URL);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 20_000 });

		await article
			.getByRole("button", { name: "Move this message", exact: true })
			.click();
		await page
			.getByRole("treeitem", { name: "Move to Inbox", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Move to Inbox", exact: true })
			.click();

		// The failure this spec exists for was loud in exactly two places: an
		// error banner, and the full-screen fatal page. Neither may appear.
		await expect(page.getByTestId("fatal-error-overlay")).toHaveCount(0);
		await expect(page.getByRole("alert")).toHaveCount(0);

		// And the move has to have actually happened, not merely not-failed.
		await expect(page.getByText(run.spamSubject, { exact: true })).toHaveCount(
			0,
			{ timeout: 20_000 },
		);
		const remaining = await waitFor(
			() => api.listThreads(junkId),
			(items) => items.every((thread) => thread.subject !== run.spamSubject),
			{ timeoutMs: 30_000, what: `"${run.spamSubject}" to leave Junk` },
		);
		expect(remaining.map((thread) => thread.subject)).not.toContain(
			run.spamSubject,
		);
	});
});
