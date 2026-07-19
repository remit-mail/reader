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
	test("the synced mailbox list mirrors the server's", async ({ api, run }) => {
		const [onServer, synced] = await Promise.all([
			listServerMailboxes(),
			api.listMailboxes(run.accountId),
		]);
		const syncedPaths = synced.map((mailbox) => mailbox.fullPath);

		expect(syncedPaths).toContain("INBOX");
		for (const path of ["Sent", "Drafts", "Trash"]) {
			expect(onServer).toContain(path);
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
			{ timeoutMs: 45_000, what: "the seeded messages to finish syncing" },
		);
		const subjects = threads.map((thread) => thread.subject);
		for (const seeded of run.seededSubjects) {
			expect(subjects).toContain(seeded);
		}
	});

	// Known-failing, and annotated rather than deleted or weakened. Mail that
	// arrives after an account is connected does not reach the API on a
	// triggered sync: on a freshly connected account the message is still absent
	// after minutes of polling, while the same append against a worker that has
	// just restarted lands in about two seconds. `test.fail` keeps the assertion
	// running and the suite honest — when the defect is fixed this spec reports
	// "expected to fail but passed" and the annotation has to come off.
	test.fail(
		"a message appended after onboarding arrives on the next sync",
		async ({ api, run }) => {
			const subject = `Late arrival ${Date.now()}`;
			await appendMessages([{ subject, body: "Appended mid-run." }]);
			await api.triggerSync(run.accountId);

			const threads = await waitFor(
				() => api.listThreads(run.inboxId),
				(items) => items.some((thread) => thread.subject === subject),
				{ timeoutMs: 45_000, what: `the appended message "${subject}"` },
			);
			expect(threads.map((thread) => thread.subject)).toContain(subject);
		},
	);
});
