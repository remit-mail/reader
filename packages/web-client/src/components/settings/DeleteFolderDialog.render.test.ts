import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DeleteFolderDialog } from "./DeleteFolderDialog";

// remit-ui's `.tsx` is transpiled with the classic JSX runtime, which
// references a global `React`; the app uses the automatic runtime, so this
// shim only exists for the test harness.
(globalThis as { React?: typeof React }).React = React;

const mailbox = (
	over: Partial<RemitImapMailboxResponse> & {
		mailboxId: string;
		fullPath: string;
	},
): RemitImapMailboxResponse =>
	({
		accountId: "acc-1",
		namespaceType: "personal",
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...over,
	}) as RemitImapMailboxResponse;

const mailboxes: RemitImapMailboxResponse[] = [
	mailbox({ mailboxId: "inbox", fullPath: "INBOX" }),
	mailbox({ mailboxId: "receipts", fullPath: "Receipts", messageCount: 3 }),
	mailbox({ mailboxId: "empty", fullPath: "Empty" }),
	mailbox({ mailboxId: "archive", fullPath: "Archive" }),
];

const appointments: RemitImapFolderAppointment[] = [
	{ role: "Inbox", mailboxId: "inbox" },
	{ role: "Archive", mailboxId: "archive" },
];

let container: HTMLElement;
let root: Root;
const originalFetch = globalThis.fetch;

interface FetchCall {
	url: string;
	method: string;
	body: string;
}
type FetchRoute = (call: FetchCall) => Response;
let route: FetchRoute = () => new Response("{}", { status: 200 });

const json = (body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

const threadItems = (ids: readonly string[]) => ({
	items: ids.map((id) => ({
		threadMessageId: `t-${id}`,
		threadId: "th",
		messageId: id,
		accountConfigId: "acc-1",
		mailboxId: "receipts",
		isDeleted: false,
	})),
});

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const request = input as Request;
		const body = request.method === "GET" ? "" : await request.clone().text();
		return route({ url: request.url, method: request.method, body });
	}) as typeof fetch;
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	globalThis.fetch = originalFetch;
});

const render = (props: {
	open: boolean;
	folder: RemitImapMailboxResponse;
	onClose?: () => void;
}) => {
	act(() => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(DeleteFolderDialog, {
					open: props.open,
					accountId: "acc-1",
					folder: props.folder,
					mailboxes,
					appointments,
					onClose: props.onClose ?? (() => undefined),
				}),
			) as never,
		);
	});
};

const buttonByText = (re: RegExp): HTMLButtonElement | undefined =>
	Array.from(container.querySelectorAll("button")).find((b) =>
		re.test(b.textContent ?? ""),
	);

const flush = async () => {
	for (let i = 0; i < 12; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

describe("DeleteFolderDialog", () => {
	it("renders nothing when closed", () => {
		render({ open: false, folder: mailboxes[1] as RemitImapMailboxResponse });
		assert.equal(container.textContent, "");
	});

	it("confirms a single destructive step for an empty folder", () => {
		render({ open: true, folder: mailboxes[2] as RemitImapMailboxResponse });
		assert.match(container.textContent ?? "", /empty and will be removed/);
		assert.ok(buttonByText(/^Delete folder$/), "delete folder button present");
	});

	it("asks what happens to the mail for a non-empty folder", () => {
		render({ open: true, folder: mailboxes[1] as RemitImapMailboxResponse });
		assert.match(container.textContent ?? "", /holds 3 emails/);
		assert.ok(buttonByText(/Delete them with the folder/));
		assert.ok(buttonByText(/Move them to another folder/));
	});

	it("routes the delete-with-folder choice to a counted confirm and back", () => {
		render({ open: true, folder: mailboxes[1] as RemitImapMailboxResponse });
		act(() => buttonByText(/Delete them with the folder/)?.click());
		assert.match(container.textContent ?? "", /and its 3 emails/);
		assert.ok(buttonByText(/Delete folder and emails/));
		act(() => buttonByText(/^Back$/)?.click());
		assert.match(container.textContent ?? "", /What should happen to them/);
	});

	it("offers a destination picker that excludes the folder being deleted", () => {
		render({ open: true, folder: mailboxes[1] as RemitImapMailboxResponse });
		act(() => buttonByText(/Move them to another folder/)?.click());
		const search = container.querySelector(
			'input[aria-label="Filter folders"]',
		);
		assert.ok(search, "the move picker is shown");
		const options = Array.from(container.querySelectorAll('[role="option"]'))
			.map((o) => o.textContent ?? "")
			.join("|");
		assert.doesNotMatch(options, /Receipts/);
		assert.match(options, /Archive/);
	});

	it("deletes an empty folder and closes on success", async () => {
		let closed = false;
		route = ({ method }) => {
			if (method === "DELETE") return new Response(null, { status: 204 });
			return new Response("{}", { status: 200 });
		};
		render({
			open: true,
			folder: mailboxes[2] as RemitImapMailboxResponse,
			onClose: () => {
				closed = true;
			},
		});
		await act(async () => {
			buttonByText(/^Delete folder$/)?.click();
		});
		await flush();
		assert.equal(closed, true);
	});

	it("moves the mail in batches then deletes the emptied folder", async () => {
		let closed = false;
		let moved: string[] = [];
		let threadCalls = 0;
		route = ({ url, method, body: reqBody }) => {
			if (method === "DELETE") return new Response(null, { status: 204 });
			if (url.includes("/messages/move")) {
				const body = JSON.parse(reqBody) as { messageIds: string[] };
				moved = moved.concat(body.messageIds);
				return new Response(JSON.stringify({ moved: body.messageIds.length }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.includes("/threads")) {
				threadCalls += 1;
				const items =
					threadCalls === 1
						? ["m1", "m2", "m3"].map((id) => ({
								threadMessageId: `t-${id}`,
								threadId: "th",
								messageId: id,
								accountConfigId: "acc-1",
								mailboxId: "receipts",
								isDeleted: false,
							}))
						: [];
				return new Response(JSON.stringify({ items }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(JSON.stringify({ items: mailboxes }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		render({
			open: true,
			folder: mailboxes[1] as RemitImapMailboxResponse,
			onClose: () => {
				closed = true;
			},
		});
		act(() => buttonByText(/Move them to another folder/)?.click());
		await act(async () => {
			(
				container.querySelector('button[aria-label="Move to Archive"]') as
					| HTMLButtonElement
					| undefined
			)?.click();
		});
		await flush();
		assert.deepEqual(moved.sort(), ["m1", "m2", "m3"]);
		assert.equal(closed, true);
	});

	it("surfaces a failed batch and keeps the dialog open", async () => {
		let closed = false;
		route = ({ url }) => {
			if (url.includes("/messages/move"))
				return new Response(JSON.stringify({ detail: "server exploded" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				});
			if (url.includes("/threads"))
				return new Response(
					JSON.stringify({
						items: [
							{
								threadMessageId: "t1",
								threadId: "th",
								messageId: "m1",
								accountConfigId: "acc-1",
								mailboxId: "receipts",
								isDeleted: false,
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			return new Response(JSON.stringify({ items: mailboxes }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		render({
			open: true,
			folder: mailboxes[1] as RemitImapMailboxResponse,
			onClose: () => {
				closed = true;
			},
		});
		act(() => buttonByText(/Move them to another folder/)?.click());
		await act(async () => {
			(
				container.querySelector('button[aria-label="Move to Archive"]') as
					| HTMLButtonElement
					| undefined
			)?.click();
		});
		await flush();
		assert.match(container.textContent ?? "", /stay moved/);
		assert.equal(closed, false);
	});

	const clickMoveToArchive = async () => {
		act(() => buttonByText(/Move them to another folder/)?.click());
		await act(async () => {
			(
				container.querySelector('button[aria-label="Move to Archive"]') as
					| HTMLButtonElement
					| undefined
			)?.click();
		});
	};

	it("iterates multiple batches and deletes only after the folder drains", async () => {
		let deleted = false;
		const moveCalls: string[][] = [];
		let threadRound = 0;
		route = ({ url, method, body: reqBody }) => {
			if (method === "DELETE") {
				deleted = true;
				return new Response(null, { status: 204 });
			}
			if (url.includes("/messages/move")) {
				const body = JSON.parse(reqBody) as { messageIds: string[] };
				moveCalls.push(body.messageIds);
				return json({ moved: body.messageIds.length });
			}
			if (url.includes("/threads")) {
				threadRound += 1;
				if (threadRound === 1) return json(threadItems(["m1", "m2"]));
				if (threadRound === 2) return json(threadItems(["m3", "m4"]));
				return json(threadItems([]));
			}
			return json({ items: mailboxes });
		};
		render({ open: true, folder: mailboxes[1] as RemitImapMailboxResponse });
		await clickMoveToArchive();
		await flush();
		assert.equal(moveCalls.length, 2, "two move calls, one per batch");
		assert.deepEqual(moveCalls[0], ["m1", "m2"]);
		assert.deepEqual(moveCalls[1], ["m3", "m4"]);
		assert.equal(deleted, true, "delete fires only after drain and recheck");
	});

	it("does not delete or error when the dialog is closed mid-move", async () => {
		let deleted = false;
		let closed = false;
		const moveCalls: string[][] = [];
		route = ({ url, method, body: reqBody }) => {
			if (method === "DELETE") {
				deleted = true;
				return new Response(null, { status: 204 });
			}
			if (url.includes("/messages/move")) {
				const body = JSON.parse(reqBody) as { messageIds: string[] };
				moveCalls.push(body.messageIds);
				container
					.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')
					?.click();
				return json({ moved: body.messageIds.length });
			}
			if (url.includes("/threads")) return json(threadItems(["m1", "m2"]));
			return json({ items: mailboxes });
		};
		render({
			open: true,
			folder: mailboxes[1] as RemitImapMailboxResponse,
			onClose: () => {
				closed = true;
			},
		});
		await clickMoveToArchive();
		await flush();
		assert.equal(closed, true, "closing the dialog aborts the run");
		assert.equal(moveCalls.length, 1, "the in-flight batch completes");
		assert.equal(deleted, false, "abort never reaches the delete");
		assert.doesNotMatch(
			container.textContent ?? "",
			/went wrong|still syncing|stay moved/,
			"aborting is a cancel, not an error",
		);
	});

	it("refuses the delete when an independent recheck still sees mail", async () => {
		let deleted = false;
		const moveCalls: string[][] = [];
		route = ({ url, method, body: reqBody }) => {
			if (method === "DELETE") {
				deleted = true;
				return new Response(null, { status: 204 });
			}
			if (url.includes("/messages/move")) {
				const body = JSON.parse(reqBody) as { messageIds: string[] };
				moveCalls.push(body.messageIds);
				return json({ moved: body.messageIds.length });
			}
			if (url.includes("/threads")) return json(threadItems(["m1"]));
			return json({ items: mailboxes });
		};
		render({ open: true, folder: mailboxes[1] as RemitImapMailboxResponse });
		await clickMoveToArchive();
		await flush();
		assert.equal(
			moveCalls.length,
			1,
			"m1 moves once, then the drain filters it",
		);
		assert.equal(
			deleted,
			false,
			"a live message still listed blocks the delete",
		);
		assert.match(container.textContent ?? "", /still syncing/);
	});

	it("resumes after re-open and skips already-moved mail", async () => {
		let deleted = false;
		const moveCalls: string[][] = [];
		const movedOnServer = new Set<string>();
		const folderIds = ["m1", "m2"];
		let interruptNextMove = true;
		route = ({ url, method, body: reqBody }) => {
			if (method === "DELETE") {
				deleted = true;
				return new Response(null, { status: 204 });
			}
			if (url.includes("/messages/move")) {
				const body = JSON.parse(reqBody) as { messageIds: string[] };
				moveCalls.push(body.messageIds);
				for (const id of body.messageIds) movedOnServer.add(id);
				if (interruptNextMove) {
					interruptNextMove = false;
					container
						.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')
						?.click();
				}
				return json({ moved: body.messageIds.length });
			}
			if (url.includes("/threads"))
				return json(
					threadItems(folderIds.filter((id) => !movedOnServer.has(id))),
				);
			return json({ items: mailboxes });
		};
		render({ open: true, folder: mailboxes[1] as RemitImapMailboxResponse });
		await clickMoveToArchive();
		await flush();
		assert.deepEqual(
			moveCalls,
			[["m1", "m2"]],
			"run one moves the first batch",
		);
		assert.equal(deleted, false, "the interrupted run does not delete");

		folderIds.push("m3");
		render({ open: false, folder: mailboxes[1] as RemitImapMailboxResponse });
		render({ open: true, folder: mailboxes[1] as RemitImapMailboxResponse });
		await clickMoveToArchive();
		await flush();

		const secondRunIds = moveCalls.slice(1).flat();
		assert.deepEqual(
			secondRunIds,
			["m3"],
			"the resumed run moves only what is left, skipping already-moved ids",
		);
		assert.equal(deleted, true, "the resumed run drains and deletes");
	});
});
