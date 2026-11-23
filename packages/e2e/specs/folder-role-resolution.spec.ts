/**
 * Conventional leaf names resolve account-local roles, while server flags
 * outrank names. Selectable name candidates survive beside flagged folders.
 * Uses a throwaway account so its extra sidebar folders cannot affect other specs.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { createServerMailbox, describeServerMailboxes } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const NESTED_UNFLAGGED = "INBOX/All Mail";

const NESTED_ARCHIVE = "INBOX/Archives";

const ROOT_FOLDERS = ["INBOX", "Archive", "Trash", "Junk", "Sent"];

test.describe("Canonical role resolution", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Folder Role Resolution");
		await createServerMailbox(run.imapUser, NESTED_UNFLAGGED);
		await createServerMailbox(run.imapUser, NESTED_ARCHIVE);
		api = new ApiClient(run);
		await api.triggerSync(run.accountId);
	});

	test("resolves a nested unflagged folder by its leaf, and lets the flag outrank it", async () => {
		test.setTimeout(180_000);

		// The fixture is only worth something if the server really advertises no
		// SPECIAL-USE for the nested folder and really composes its path with
		// this delimiter.
		const onServer = await describeServerMailboxes(run.imapUser);
		const nested = onServer.find((box) => box.path === NESTED_UNFLAGGED);
		expect(nested?.delimiter).toBe("/");
		expect(nested?.specialUse).toBeUndefined();
		expect(onServer.find((box) => box.path === "Archive")?.specialUse).toBe(
			"\\Archive",
		);

		const wanted = [...ROOT_FOLDERS, NESTED_UNFLAGGED, NESTED_ARCHIVE];
		const mailboxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) =>
				wanted.every((path) => list.some((box) => box.fullPath === path)),
			{ timeoutMs: 90_000, what: "the account's folders to sync" },
		);
		const idOf = (fullPath: string): string => {
			const found = mailboxes.find((box) => box.fullPath === fullPath);
			if (!found) throw new Error(`unreachable: ${fullPath} has not synced`);
			return found.mailboxId;
		};

		const appointments = await api.listFolderAppointments(run.accountId);
		const folderFor = (role: string): string | undefined =>
			appointments.find((entry) => entry.role === role)?.mailboxId;

		// Nothing is appointed and no folder carries \All, so the leaf segment is
		// the only thing that can have resolved this one.
		expect(folderFor("All")).toBe(idOf(NESTED_UNFLAGGED));

		// All Mail remains separate from Archive. The flagged Archive outranks
		// INBOX/Archives, which still remains visible in the projection.
		expect(folderFor("Archive")).toBe(idOf("Archive"));
		expect(folderFor("Trash")).toBe(idOf("Trash"));
		expect(folderFor("Junk")).toBe(idOf("Junk"));
		expect(folderFor("Sent")).toBe(idOf("Sent"));
		expect(folderFor("Inbox")).toBe(idOf("INBOX"));
	});
});
