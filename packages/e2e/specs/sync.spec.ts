/**
 * The load-bearing spec: mail that exists on the IMAP server has to end up
 * readable through the API. Everything between the two — the queue sidecar, the
 * imap-worker's event fan-out, the SQLite writes — is exercised only here, and
 * only from outside.
 */
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, listServerMailboxes } from "../src/imap.js";

test.describe("Sync", () => {
	// Global setup waits only for INBOX, so the rest of the folders may still be
	// arriving. Polling here is what makes this spec independent of the order
	// Playwright happens to run files in, and of how fast the runner is.
	test("the synced mailbox list mirrors the server's", async ({ api, run }) => {
		const expected = ["INBOX", "Sent", "Drafts", "Trash"];

		const onServer = await listServerMailboxes(run.imapUser);
		for (const path of expected) {
			expect(onServer).toContain(path);
		}

		const synced = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => {
				const paths = list.map((mailbox) => mailbox.fullPath);
				return expected.every((path) => paths.includes(path));
			},
			{ timeoutMs: 30_000, what: "every server mailbox to finish syncing" },
		);

		const syncedPaths = synced.map((mailbox) => mailbox.fullPath);
		for (const path of expected) {
			expect(syncedPaths).toContain(path);
		}
	});

	test("the messages seeded before sync are readable through the API", async ({
		api,
		run,
	}) => {
		const threads = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.length >= run.seededSubjects.length,
			{ timeoutMs: 30_000, what: "the seeded messages to finish syncing" },
		);

		// The mailbox this run owns started empty, so this is the whole of what
		// synced — not a superset that happens to contain the right subjects.
		expect(threads.map((thread) => thread.subject).sort()).toEqual(
			[...run.seededSubjects].sort(),
		);
	});

	// The core loop: mail that arrives after setup reaches the API on the next
	// triggered sync. This ran right after a sync had already completed, which
	// is what made it fail (issue #37) — the trigger was discarded as a
	// duplicate of the one before it. The window is short on purpose: the
	// message either comes through on this sync or the sync was dropped.
	test("a message appended after onboarding arrives on the next sync", async ({
		api,
		run,
	}) => {
		const subject = `Late arrival ${Date.now()}`;
		await appendMessages(run.imapUser, [
			{ subject, body: "Appended mid-run." },
		]);
		await api.triggerSync(run.accountId);

		const threads = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.some((thread) => thread.subject === subject),
			{ timeoutMs: 15_000, what: `the appended message "${subject}"` },
		);
		expect(threads.map((thread) => thread.subject)).toContain(subject);
	});
});
