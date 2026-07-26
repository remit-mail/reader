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
import {
	type AccountSyncStatus,
	ApiClient,
	type MailboxSyncProgress,
	waitFor,
} from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	listServerMailboxes,
	listServerSubjects,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };

/** Which folder in the sync status a wait is about — by id, or by path when the point is that it goes away. */
type FolderRef = { mailboxId: string } | { fullPath: string };

const findFolder = (
	status: AccountSyncStatus,
	ref: FolderRef,
): MailboxSyncProgress | undefined =>
	status.mailboxes.find((folder) =>
		"mailboxId" in ref
			? folder.mailboxId === ref.mailboxId
			: folder.fullPath === ref.fullPath,
	);

const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * How many messages the app itself holds in a folder, counted per message.
 *
 * `listThreads` collapses similar subjects into one thread, so its length is not
 * a message count; expanding each thread and keeping the messages filed in this
 * folder is. This is the app's own ingested state — distinct from the folder's
 * `messagesTotal`, which is what the IMAP server reported.
 */
const countAppMessages = async (
	api: ApiClient,
	mailboxId: string,
): Promise<number> => {
	const threads = await api.listThreads(mailboxId);
	const perThread = await Promise.all(
		threads.map((thread) => api.listThreadMessages(thread.threadId)),
	);
	return perThread.flat().filter((message) => message.mailboxId === mailboxId)
		.length;
};

/**
 * What a wait looks at each round: the deployment's own account of the folder,
 * and — when the wait names a folder by id — how many messages the app holds in
 * it. Both, because the two answer different questions: `messagesTotal` is the
 * server's count, `appMessages` is what synced.
 */
interface FolderObservation {
	folder?: MailboxSyncProgress;
	appMessages?: number;
}

const observe = async (
	api: ApiClient,
	accountId: string,
	ref: FolderRef,
): Promise<FolderObservation> => {
	const folder = findFolder(await api.getSyncStatus(accountId), ref);
	if (!("mailboxId" in ref)) return { folder };
	return { folder, appMessages: await countAppMessages(api, ref.mailboxId) };
};

/**
 * Trigger one sync, then wait for that sync to reach the folder before
 * triggering another.
 *
 * Explicit syncs must not overlap: the account's mailbox operations run on one
 * ordered queue, and two reconciles in flight at once can race — one removing a
 * row the other still expects. What paces the triggers here is the deployment's
 * own per-mailbox sync cursor rather than an interval chosen to be longer than a
 * round: `lastSyncedAt` moves on every message-sync round for that folder, empty
 * rounds included, so an advance of it is the moment asking again is worth
 * anything.
 *
 * A wait that never settles reports the folder as the deployment last described
 * it — its phase, the count it read off the server, how far its messages got,
 * when it last synced, how many the app holds — and how many rounds were asked
 * for. That is what separates a seed that never landed from a sync that never ran
 * from a sync that ran and disagrees.
 */
const nudgeUntil = async (
	api: ApiClient,
	accountId: string,
	ref: FolderRef,
	accept: (observation: FolderObservation) => boolean,
	{ timeoutMs, what }: { timeoutMs: number; what: string },
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	let rounds = 0;
	let observed: FolderObservation | undefined;
	let lastError: unknown;
	let cursor = await observe(api, accountId, ref)
		.then((observation) => observation.folder?.lastSyncedAt ?? 0)
		.catch(() => 0);

	while (Date.now() < deadline) {
		await api.triggerSync(accountId).catch(() => undefined);
		rounds += 1;

		const observation = await waitFor(
			() => observe(api, accountId, ref),
			(current) =>
				accept(current) || (current.folder?.lastSyncedAt ?? 0) > cursor,
			{ timeoutMs: 30_000, intervalMs: 1_000, what },
		).then(
			(value) => value,
			(error: unknown) => {
				lastError = error;
				return undefined;
			},
		);

		if (!observation) continue;
		lastError = undefined;
		observed = observation;
		if (accept(observed)) return;
		cursor = Math.max(cursor, observed.folder?.lastSyncedAt ?? 0);
	}

	const seen = lastError
		? `last read failed: ${describeError(lastError)}`
		: `last observed: ${JSON.stringify(observed ?? null)}`;
	throw new Error(
		`timed out after ${timeoutMs}ms waiting for ${what}, over ${rounds} sync round(s); ${seen}`,
	);
};

/**
 * Append a handful of tagged messages into a folder and wait until both the
 * server and the app hold them.
 *
 * Both halves are needed, and neither substitutes for the other. The server's
 * count says the mail arrived; it is written by the mailbox sweep as well as by
 * message sync, so on its own it can be satisfied while the messages are still
 * unsynced. The app's own per-message count is what everything downstream of a
 * seed acts on: the delete wizard offers a choice about mail the app knows
 * exists, and moves the messages it has.
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
		{ mailboxId },
		({ folder, appMessages }) =>
			(appMessages ?? 0) >= subjects.length &&
			(folder?.messagesTotal ?? 0) >= subjects.length,
		{
			timeoutMs: 300_000,
			what: "the server and the app to both hold the seed",
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
		{ fullPath: name },
		({ folder }) => !folder || folder.messagesTotal === 0,
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
			{ mailboxId: dest.mailboxId },
			({ folder }) => (folder?.messagesTotal ?? 0) >= subjects.length,
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
