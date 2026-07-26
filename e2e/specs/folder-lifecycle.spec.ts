/**
 * The trust spec for folder create/delete: it proves the features against the
 * real IMAP server, not just the app's own cache.
 *
 * A folder is created from the Settings › Folders form; the assertion is that
 * Dovecot itself now lists it (server-side LIST, after the worker syncs) — the
 * app claiming it exists is not enough. Mail is then appended into that folder
 * over IMAP the way any client would, synced, and the delete wizard is driven
 * to its end: the move path relocates the mail into another folder and removes
 * the emptied one, the delete-all path removes folder and mail together. Both
 * end with the server, not the UI, asked whether the folder is gone.
 *
 * Mid-run seeding into a deletable folder is what a previous pass reported as
 * impossible; it is not. `POST /sync` is an explicit request that syncs every
 * mailbox regardless of how recently one ran (see `sync.spec.ts`), so a folder's
 * freshly-appended mail reaches the API on the next trigger.
 *
 * This runs as its own throwaway user, not the shared onboarded one. Deleting a
 * folder that has held mail leaves the account's message queue holding stale
 * events for a mailbox that no longer exists (#287); that is contained to the account
 * it happened on, so isolating the churn here keeps every other spec's reads of
 * the shared mailbox clean (see `src/provision.ts`).
 *
 * The move-then-delete wizard empties the folder before removing it, and defers
 * the removal when a just-issued move has not yet reflected in the source
 * listing — its documented "re-open delete to finish" contract. This drives that
 * to completion rather than assuming the single pass lands.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	listServerMailboxes,
	listServerSubjects,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };

/**
 * Trigger one sync, then poll before triggering again. Explicit syncs must not
 * overlap: the account's mailbox operations run on one ordered queue, and two
 * reconciles in flight at once can race — one removing a row the other still
 * expects. Spacing the triggers past a sync's own duration keeps each one
 * uncontended, which is the difference between settling in seconds and a
 * hammered queue that never catches up.
 */
const nudgeUntil = async <T>(
	api: ApiClient,
	accountId: string,
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	{ timeoutMs, what }: { timeoutMs: number; what: string },
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await api.triggerSync(accountId).catch(() => undefined);
		const ok = await waitFor(read, accept, {
			timeoutMs: 30_000,
			intervalMs: 3_000,
			what,
		})
			.then(() => true)
			.catch(() => false);
		if (ok) return;
	}
	throw new Error(`timed out waiting for ${what}`);
};

/**
 * Append a handful of tagged messages into a folder and wait for the sync to
 * carry them to the API. Gates on the mailbox's message count, not on
 * `listThreads`: the latter returns threads, and similar subjects collapse into
 * one, so an every-subject check can never settle. The count is per-message.
 */
const seedFolder = async (
	api: ApiClient,
	run: IsolatedRun,
	fullPath: string,
	mailboxId: string,
	subjects: string[],
): Promise<void> => {
	await appendMessages(
		run.imapUser,
		subjects.map((subject) => ({ subject, body: `Body of ${subject}.` })),
		fullPath,
	);

	await nudgeUntil(
		api,
		run.accountId,
		() => api.listMailboxes(run.accountId),
		(boxes) =>
			(boxes.find((b) => b.mailboxId === mailboxId)?.messageCount ?? 0) >=
			subjects.length,
		{
			timeoutMs: 300_000,
			what: "the folder's message count to reflect the seed",
		},
	);
};

/** Create a top-level folder through the Settings form and return its synced identity. */
const createFolderFromSettings = async (
	page: Page,
	api: ApiClient,
	run: IsolatedRun,
	name: string,
): Promise<{ mailboxId: string; fullPath: string }> => {
	await page.goto("/settings/folders");
	await expect(
		page.getByRole("heading", { name: "Folder roles", exact: true }),
	).toBeVisible({ timeout: 30_000 });

	const nameField = page.getByRole("textbox", { name: "Folder name" }).first();
	await expect(nameField).toBeVisible({ timeout: 20_000 });
	await nameField.fill(name);
	await page.getByRole("button", { name: "Create folder" }).first().click();

	const created = await waitFor(
		() => api.listMailboxes(run.accountId),
		(boxes) => boxes.some((b) => b.fullPath === name),
		{ timeoutMs: 60_000, what: `the folder "${name}" to appear in the API` },
	);
	const mailbox = created.find((b) => b.fullPath === name);
	if (!mailbox) throw new Error("unreachable: folder matched but not found");

	// The load-bearing assertion: Dovecot itself lists the folder, so the worker
	// really created it on the server rather than only writing a local row.
	await waitFor(
		() => listServerMailboxes(run.imapUser),
		(paths) => paths.includes(name),
		{
			timeoutMs: 60_000,
			what: `the folder "${name}" to exist on the IMAP server`,
		},
	);

	return { mailboxId: mailbox.mailboxId, fullPath: mailbox.fullPath };
};

const folderRow = (page: Page, email: string, name: string) =>
	page
		.getByRole("list", { name: `All folders for ${email}` })
		.getByRole("listitem")
		.filter({ hasText: name });

const openDeleteWizard = async (
	page: Page,
	email: string,
	name: string,
): Promise<void> => {
	await page.goto("/settings/folders");
	const row = folderRow(page, email, name);
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.getByRole("button", { name: `Delete ${name}` }).click();
};

/**
 * Drive a folder's deletion to completion. The move-then-delete pass may have
 * removed it already, or deferred the removal until the move reflects — in which
 * case re-opening finds the now-empty folder and its plain confirm finishes the
 * job.
 */
const deleteFolderCompletely = async (
	page: Page,
	api: ApiClient,
	run: IsolatedRun,
	name: string,
): Promise<void> => {
	// Let the source empty first (the move-then-delete may already have removed
	// the folder outright, or parked it empty). One paced sync, not a storm.
	await nudgeUntil(
		api,
		run.accountId,
		() => api.listMailboxes(run.accountId),
		(boxes) => {
			const box = boxes.find((b) => b.fullPath === name);
			return !box || (box.messageCount ?? 0) === 0;
		},
		{ timeoutMs: 120_000, what: `"${name}" to empty or be removed` },
	);

	const boxes = await api.listMailboxes(run.accountId);
	if (!boxes.some((b) => b.fullPath === name)) return;

	// The folder is empty but still here — the wizard deferred its removal. Finish
	// through the same wizard, now a single empty-folder confirm.
	await page.goto("/settings/folders");
	const row = folderRow(page, run.imapUser, name);
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.getByRole("button", { name: `Delete ${name}` }).click();
	const confirmEmpty = page.getByRole("button", {
		name: "Delete folder",
		exact: true,
	});
	await expect(confirmEmpty).toBeVisible({ timeout: 10_000 });
	await confirmEmpty.click();
	await expect(row).toHaveCount(0, { timeout: 30_000 });
};

test.describe("Folder lifecycle against the IMAP server", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;
	const created: string[] = [];

	test.beforeAll(async ({ browser }) => {
		run = await provisionIsolatedRun("E2E Folder Lifecycle");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		const boxes = await api.listMailboxes(run.accountId);
		// Sequentially, not in parallel: concurrent deletes on the account's one
		// ordered mailbox queue can race each other's reconciles.
		for (const box of boxes.filter((b) => created.includes(b.fullPath))) {
			await api.deleteMailbox(run.accountId, box.mailboxId);
		}
		await context.close();
	});

	test("create a folder, seed it over IMAP, then move its mail out and delete it — verified on the server", async () => {
		test.setTimeout(600_000);
		const page = await context.newPage();
		const stamp = Date.now();
		const sourceName = `E2E Lifecycle ${stamp}`;
		const destName = `E2E Keep ${stamp}`;
		const subjects = [1, 2, 3].map((n) => `E2E Move ${stamp} #${n}`);
		created.push(sourceName, destName);

		// Source first, seeded and settled, before the destination exists — two
		// folder creates racing each other's first sync on the one account queue is
		// what stalls a seed.
		const source = await createFolderFromSettings(page, api, run, sourceName);
		await seedFolder(api, run, source.fullPath, source.mailboxId, subjects);

		// Now the move destination. Created directly — the create surface itself is
		// proven above via the source folder.
		const dest = await api.createMailbox(run.accountId, destName);
		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => paths.includes(destName),
			{
				timeoutMs: 60_000,
				what: `the destination "${destName}" on the server`,
			},
		);

		await openDeleteWizard(page, run.imapUser, sourceName);

		// A folder holding mail asks what happens to it first.
		await page
			.getByRole("button", { name: /Move them to another folder/ })
			.click();

		const picker = page.getByRole("searchbox", { name: "Filter folders" });
		await expect(picker).toBeVisible({ timeout: 10_000 });
		await picker.fill(destName);
		await page.getByRole("option", { name: `Move to ${destName}` }).click();

		// The mail is in the destination — asked of the API, not the UI's optimism.
		// Counted rather than subject-matched: the count is per-message where a
		// thread listing collapses similar subjects.
		await nudgeUntil(
			api,
			run.accountId,
			() => api.listMailboxes(run.accountId),
			(boxes) =>
				(boxes.find((b) => b.mailboxId === dest.mailboxId)?.messageCount ??
					0) >= subjects.length,
			{
				timeoutMs: 120_000,
				what: "every moved message to land in the destination",
			},
		);

		// The emptied source folder is removed — through the wizard, finishing the
		// deferred delete if the move-then-delete pass parked it.
		await deleteFolderCompletely(page, api, run, sourceName);

		// The source folder is gone from the IMAP server itself.
		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => !paths.includes(sourceName),
			{ timeoutMs: 60_000, what: `"${sourceName}" to leave the IMAP server` },
		);
	});

	test("create a folder, seed it, then delete folder and mail together — verified on the server", async () => {
		test.setTimeout(600_000);
		const page = await context.newPage();
		const stamp = Date.now();
		const folderName = `E2E DeleteAll ${stamp}`;
		const subjects = [1, 2, 3].map((n) => `E2E Purge ${stamp} #${n}`);
		created.push(folderName);

		const folder = await createFolderFromSettings(page, api, run, folderName);
		await seedFolder(api, run, folder.fullPath, folder.mailboxId, subjects);

		// The mail really is on the server before the delete-all removes it.
		expect(await listServerSubjects(run.imapUser, folderName)).toHaveLength(
			subjects.length,
		);

		await openDeleteWizard(page, run.imapUser, folderName);
		await page
			.getByRole("button", { name: /Delete them with the folder/ })
			.click();
		await page
			.getByRole("button", { name: "Delete folder and emails" })
			.click();

		// Folder and its mail are gone from the server — a deleted mailbox holds
		// nothing to list, so its absence is the whole assertion.
		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => !paths.includes(folderName),
			{
				timeoutMs: 90_000,
				what: `"${folderName}" and its mail to leave the server`,
			},
		);
		await page.goto("/settings/folders");
		await expect(folderRow(page, run.imapUser, folderName)).toHaveCount(0, {
			timeout: 30_000,
		});
	});
});
