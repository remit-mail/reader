/**
 * useCreateMailbox.createFolder — the shared create seam the kit surfaces call.
 * It validates the typed name against the account's current folders with the
 * same IMAP-aware rules the settings form uses, and rejects with the
 * human-readable reason before any request. The mailbox list is seeded into the
 * query cache the hook reads, so validation runs against real paths.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	MailboxOperationsListMailboxesResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { FolderOption } from "@remit/ui";
import { act, createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { useCreateMailbox } from "./useCreateMailbox";

const ACCOUNT = "acc-1";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let createFolder: ((name: string) => Promise<FolderOption>) | undefined;

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

const mount = (items: RemitImapMailboxResponse[]) => {
	http = mockFetch((call) => {
		if (call.method === "POST") {
			const body = call.body as { fullPath: string };
			return { mailboxId: `mbx-${body.fullPath}`, fullPath: body.fullPath };
		}
		return { items };
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

	it("passes a valid name through to the create request and maps the result", async () => {
		mount([mailbox("INBOX", "/")]);
		let result: FolderOption | undefined;
		await act(async () => {
			result = await createFolder?.("Taxes");
		});
		const posts = (http?.calls ?? []).filter((call) => call.method === "POST");
		assert.equal(posts.length, 1);
		assert.deepEqual(posts[0].body, {
			fullPath: "Taxes",
			namespaceType: "personal",
		});
		assert.equal(result?.label, "Taxes");
	});
});
