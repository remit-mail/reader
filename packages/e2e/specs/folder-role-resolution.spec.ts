/**
 * A folder resolves to its canonical role by its own leaf segment, and the
 * server's SPECIAL-USE flag still outranks that name (#837).
 *
 * Every folder Dovecot gives a new account is root-level and flagged, so the
 * name rule was the one tier the suite never reached — which is how `INBOX/Sent`
 * (#824) and `INBOX/Spam` (#833) both got to the instance with e2e green. This
 * run adds a nested folder carrying no SPECIAL-USE, named for the one role the
 * server flags nothing for, so nothing but the leaf-name rule can resolve it.
 * That same name is a conventional name for Archive, which the server does flag;
 * the two assertions together are the precedence rather than either half of it.
 *
 * Its own throwaway user: a folder on the shared account is a sidebar row every
 * other spec would have to account for.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { createServerMailbox, describeServerMailboxes } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

/**
 * Nested, unflagged, and named for a role no Dovecot folder advertises. It has
 * to hold a role of its own to survive the sync at all: a folder whose name is
 * a hint for a role another folder already carries the flag for is filed as a
 * lookalike and dropped from the projection.
 */
const NESTED_UNFLAGGED = "INBOX/All Mail";

const ROOT_FOLDERS = ["INBOX", "Archive", "Trash", "Junk", "Sent"];

test.describe("Canonical role resolution", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Folder Role Resolution");
		await createServerMailbox(run.imapUser, NESTED_UNFLAGGED);
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

		const wanted = [...ROOT_FOLDERS, NESTED_UNFLAGGED];
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

		// `all mail` is a conventional name for Archive too, and the folder the
		// server flagged takes the role instead.
		expect(folderFor("Archive")).toBe(idOf("Archive"));
		expect(folderFor("Trash")).toBe(idOf("Trash"));
		expect(folderFor("Junk")).toBe(idOf("Junk"));
		expect(folderFor("Sent")).toBe(idOf("Sent"));
		expect(folderFor("Inbox")).toBe(idOf("INBOX"));
	});
});
