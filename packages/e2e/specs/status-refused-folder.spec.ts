/**
 * A folder the account can LIST but not read (#1465). Dovecot's ACL plugin
 * refuses STATUS once the owner's read right is gone, the way a shared folder
 * without read rights answers. The folder is marked on its row, and the rest
 * of the account keeps syncing rather than failing on that one folder.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	createServerMailbox,
	setServerMailboxOwnerRights,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();

test.describe("A folder whose STATUS the server refuses", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Status Refused Folder");
		api = new ApiClient(run);
	});

	test("is marked refused while the other folders keep syncing", async () => {
		test.setTimeout(240_000);

		const path = `Unreadable ${STAMP}`;
		const subject = `Arrives beside a refused folder ${STAMP}`;

		await createServerMailbox(run.imapUser, path);
		await api.triggerSync(run.accountId);
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === path),
			{ timeoutMs: 120_000, what: `"${path}" to be discovered` },
		);

		await setServerMailboxOwnerRights(run.imapUser, path, "l");
		await appendMessages(run.imapUser, [{ subject }], "INBOX");
		await api.triggerSync(run.accountId);

		const list = await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) =>
				boxes.some((box) => box.fullPath === path && box.statusRefused),
			{ timeoutMs: 120_000, what: `"${path}" to be marked refused` },
		);
		expect(list.find((box) => box.fullPath === "INBOX")?.statusRefused).toBe(
			false,
		);

		await waitFor(
			() => api.listAllThreads({ query: subject, accountId: run.accountId }),
			(threads) => threads.some((thread) => thread.subject === subject),
			{ timeoutMs: 120_000, what: `"${subject}" to sync into INBOX` },
		);
	});
});
