/**
 * useCreateMailbox.createFolder — the shared create seam the kit surfaces call
 * for a dependent write. It validates the typed name against the account's
 * current folders with the same IMAP-aware rules the settings form uses, rejects
 * with the human-readable reason before any request, then waits for the mail
 * server to confirm the folder before resolving — so a filter or a move never
 * binds to a still-pending row. The mailbox list is seeded into the query cache
 * the hook reads, so validation runs against real paths.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	MailboxOperationsListMailboxesResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { FolderTreeNode } from "@remit/ui";
import { act, createElement } from "react";
import { MAILBOX_SYNC_FAILED_MESSAGE } from "../lib/mailbox-sync-wait";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { useCreateMailbox } from "./useCreateMailbox";

const ACCOUNT = "acc-1";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let createFolder:
	| ((name: string, signal?: AbortSignal) => Promise<FolderTreeNode>)
	| undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	createFolder = undefined;
});

const mailbox = (
	fullPath: string,
	delimiter: string,
): RemitImapMailboxResponse =>
	({
		mailboxId: `mbx-${fullPath}`,
		accountId: ACCOUNT,
		fullPath,
		hierarchyDelimiter: delimiter,
	}) as RemitImapMailboxResponse;

function Probe() {
	createFolder = useCreateMailbox(ACCOUNT).createFolder;
	return null;
}

const mount = (
	items: RemitImapMailboxResponse[],
	createdSyncStatus: RemitImapMailboxResponse["syncStatus"] = MailboxSyncStatus.synced,
) => {
	const created: RemitImapMailboxResponse[] = [];
	http = mockFetch((call) => {
		if (call.method === "POST") {
			const body = call.body as { fullPath: string };
			created.push({
				mailboxId: `mbx-${body.fullPath}`,
				accountId: ACCOUNT,
				fullPath: body.fullPath,
				hierarchyDelimiter: "/",
				syncStatus: createdSyncStatus,
			} as RemitImapMailboxResponse);
			return { mailboxId: `mbx-${body.fullPath}`, fullPath: body.fullPath };
		}
		return { items: [...items, ...created] };
	});
	harness = createDomHarness();
	harness.queryClient.setQueryData<MailboxOperationsListMailboxesResponse>(
		mailboxOperationsListMailboxesQueryKey({ path: { accountId: ACCOUNT } }),
		{ items },
	);
	harness.renderApp(createElement(Probe));
};

const reject = async (name: string): Promise<unknown> => {
	const run = createFolder;
	if (!run) throw new Error("createFolder is not mounted");
	let caught: unknown;
	await act(async () => {
		caught = await run(name).then(
			() => undefined,
			(error: unknown) => error,
		);
	});
	return caught;
};

const postCount = (): number =>
	(http?.calls ?? []).filter((call) => call.method === "POST").length;

describe("useCreateMailbox.createFolder validation", () => {
	it("rejects a name containing the account delimiter before any request", async () => {
		mount([mailbox("INBOX", "/")]);
		const error = await reject("Work/Receipts");
		assert.ok(error instanceof Error);
		assert.match(error.message, /can't contain/);
		assert.equal(postCount(), 0);
	});

	it("honours a non-slash account delimiter", async () => {
		mount([mailbox("INBOX", ".")]);
		const error = await reject("Work.Receipts");
		assert.ok(error instanceof Error);
		assert.match(error.message, /can't contain/);
		assert.equal(postCount(), 0);
	});

	it("rejects a collision with an existing top-level fullPath before any request", async () => {
		mount([mailbox("INBOX", "/"), mailbox("Work", "/")]);
		const error = await reject("Work");
		assert.ok(error instanceof Error);
		assert.match(error.message, /already exists/);
		assert.equal(postCount(), 0);
	});

	it("treats INBOX case-insensitively for collisions", async () => {
		mount([mailbox("INBOX", "/")]);
		const error = await reject("inbox");
		assert.ok(error instanceof Error);
		assert.match(error.message, /already exists/);
		assert.equal(postCount(), 0);
	});

	it("passes a valid name through and resolves once the folder is confirmed synced", async () => {
		mount([mailbox("INBOX", "/")]);
		let result: FolderTreeNode | undefined;
		await act(async () => {
			result = await createFolder?.("Taxes");
		});
		const posts = (http?.calls ?? []).filter((call) => call.method === "POST");
		assert.equal(posts.length, 1);
		assert.deepEqual(posts[0].body, {
			fullPath: "Taxes",
			namespaceType: "personal",
		});
		// It polled the list after the create to confirm the folder before resolving.
		const gets = (http?.calls ?? []).filter((call) => call.method === "GET");
		assert.ok(gets.length >= 1, "polls the mailbox list for confirmation");
		assert.equal(result?.label, "Taxes");
	});

	it("rejects — no folder to bind a dependent write to — when the create is reported failed", async () => {
		mount([mailbox("INBOX", "/")], MailboxSyncStatus.failed);
		let caught: unknown;
		await act(async () => {
			caught = await createFolder?.("Taxes").then(
				() => undefined,
				(error: unknown) => error,
			);
		});
		assert.ok(caught instanceof Error);
		assert.equal(caught.message, MAILBOX_SYNC_FAILED_MESSAGE);
	});

	it("retry resumes the wait on the folder it already made — no second create, no 'already exists'", async () => {
		// The created folder is reported failed on the first attempt, then synced.
		let status: RemitImapMailboxResponse["syncStatus"] =
			MailboxSyncStatus.failed;
		const created: RemitImapMailboxResponse[] = [];
		http = mockFetch((call) => {
			if (call.method === "POST") {
				const body = call.body as { fullPath: string };
				created.push({
					mailboxId: `mbx-${body.fullPath}`,
					accountId: ACCOUNT,
					fullPath: body.fullPath,
					hierarchyDelimiter: "/",
				} as RemitImapMailboxResponse);
				return { mailboxId: `mbx-${body.fullPath}`, fullPath: body.fullPath };
			}
			return {
				items: [
					mailbox("INBOX", "/"),
					...created.map((entry) => ({ ...entry, syncStatus: status })),
				],
			};
		});
		harness = createDomHarness();
		harness.queryClient.setQueryData<MailboxOperationsListMailboxesResponse>(
			mailboxOperationsListMailboxesQueryKey({ path: { accountId: ACCOUNT } }),
			{ items: [mailbox("INBOX", "/")] },
		);
		harness.renderApp(createElement(Probe));

		let first: unknown;
		await act(async () => {
			first = await createFolder?.("Taxes").then(
				() => undefined,
				(error: unknown) => error,
			);
		});
		assert.ok(first instanceof Error);
		assert.equal(first.message, MAILBOX_SYNC_FAILED_MESSAGE);

		// The server confirms; the user presses "Create folder" again, same name.
		status = MailboxSyncStatus.synced;
		let result: FolderTreeNode | undefined;
		await act(async () => {
			result = await createFolder?.("Taxes");
		});
		assert.equal(result?.label, "Taxes");

		// Exactly one create across both attempts — the retry resumed, it did not
		// re-validate (which would throw "already exists") or re-POST.
		const posts = (http?.calls ?? []).filter((call) => call.method === "POST");
		assert.equal(posts.length, 1);
	});

	it("abort stops the wait so a folder that confirms later never resolves", async () => {
		mount([mailbox("INBOX", "/")], MailboxSyncStatus.pending);
		const controller = new AbortController();
		let caught: unknown;
		await act(async () => {
			const promise = createFolder?.("Taxes", controller.signal);
			controller.abort();
			caught = await promise?.then(
				() => undefined,
				(error: unknown) => error,
			);
		});
		assert.equal((caught as { name?: string })?.name, "AbortError");
	});
});
