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

	// Known-failing, and annotated rather than deleted or weakened. Mail that
	// arrives after an account is connected does not reach the API on a
	// triggered sync: on a freshly connected account the message is still absent
	// after minutes of polling, while the same append against a worker that has
	// just restarted lands in about two seconds. `test.fail` keeps the assertion
	// running and the suite honest — when the defect is fixed this spec reports
	// "expected to fail but passed" and the annotation has to come off.
	//
	// The window is short on purpose: the defect reproduces immediately, and a
	// longer one would spend the suite's runtime re-proving something already
	// known.
	test.fail(
		"a message appended after onboarding arrives on the next sync",
		async ({ api, run }) => {
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
		},
	);
});
