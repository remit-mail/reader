import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	mockFetch,
} from "../../test-support/http";
import { ComposeForm } from "./ComposeForm";
import { ComposeProvider } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1";
const OUTBOX_MESSAGE_ID = "ob-1307";
const AUTOSAVE_DEBOUNCE_MS = 2000;

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

const sourceMessage = {
	message: { messageId: "msg-1" },
	envelope: {
		subject: "The chart",
		messageIdValue: "<m1@example.com>",
		from: [{ normalizedEmail: "them@example.com", displayName: "Them" }],
		replyTo: [],
		to: [],
		cc: [],
	},
	references: [],
	bodyParts: [],
} as unknown as RemitImapDescribeMessageResponse;

(globalThis as { self?: typeof globalThis }).self ??= globalThis;

class JsdomClipboardEvent extends Event {
	readonly clipboardData: DataTransfer;

	constructor(type: string, clipboardData: DataTransfer) {
		super(type, { bubbles: true, cancelable: true });
		this.clipboardData = clipboardData;
	}
}

const clipboardGlobal = globalThis as { ClipboardEvent?: unknown };
clipboardGlobal.ClipboardEvent ??= JsdomClipboardEvent;
const ClipboardEventClass = clipboardGlobal.ClipboardEvent as new (
	type: string,
	clipboardData: DataTransfer,
) => Event;

const transferOf = (files: File[], text = ""): DataTransfer =>
	({
		types: ["Files"],
		files,
		getData: (type: string) => (type === "text/plain" ? text : ""),
	}) as unknown as DataTransfer;

before(() => {
	Object.defineProperty(Range.prototype, "getBoundingClientRect", {
		value: () => ({
			top: 0,
			bottom: 0,
			left: 0,
			right: 0,
			width: 0,
			height: 0,
			x: 0,
			y: 0,
		}),
		configurable: true,
	});
});

const rootRoute = createRootRoute();
const mailboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail/$mailboxId",
	validateSearch: (search: Record<string, unknown>) => search,
});

const testRouter = (): AnyRouter =>
	createRouter({
		routeTree: rootRoute.addChildren([mailboxRoute]),
		history: createMemoryHistory({ initialEntries: ["/mail/mbx-1"] }),
	}) as unknown as AnyRouter;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

interface ServerAttachment {
	outboxAttachmentId: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	state: "Pending" | "Stored";
}

interface Server {
	htmlBody: string;
	attachments: ServerAttachment[];
	refuseMints: boolean;
	minted: number;
	failPuts: number;
	linkGeneration: number;
	expireBefore: number;
	contentStatus: number;
}

let server: Server;

const freshServer = (): Server => ({
	htmlBody: "<p>Here it is</p>",
	attachments: [],
	refuseMints: false,
	minted: 0,
	failPuts: 0,
	linkGeneration: 0,
	expireBefore: 0,
	contentStatus: 200,
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	mock.restoreAll();
});

const CONTENT_HOST = "https://content.test";

const toResponse = (attachment: ServerAttachment) => ({
	...attachment,
	outboxMessageId: OUTBOX_MESSAGE_ID,
	contentId: `${attachment.outboxAttachmentId}@remit`,
	contentUrl: `${CONTENT_HOST}/${attachment.outboxAttachmentId}?g=${server.linkGeneration}`,
});

const outboxEntry = () => ({
	outboxMessageId: OUTBOX_MESSAGE_ID,
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["them@example.com"],
	attachments: server.attachments.map(toResponse),
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Re: The chart",
	textBody: "Here it is",
	htmlBody: server.htmlBody,
	status: "draft",
});

const refusal = (filename: string): Response =>
	new Response(
		JSON.stringify({
			code: "attachment_rejected",
			reason: "FileTooLarge",
			message: `"${filename}" is 30.0 MB, over the 25.0 MB a message can carry.`,
			limitBytes: 26_214_400,
			usedBytes: 0,
		}),
		{ status: 413, headers: { "content-type": "application/json" } },
	);

const answer = (call: HttpCall): unknown => {
	if (call.url.startsWith(CONTENT_HOST)) {
		const generation = Number(new URL(call.url).searchParams.get("g"));
		if (generation < server.expireBefore) {
			return new Response("", {
				status: 403,
				headers: { "x-remit-403-reason": "expired" },
			});
		}
		if (server.contentStatus !== 200) {
			return new Response("", { status: server.contentStatus });
		}
		return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
			status: 200,
		});
	}
	if (call.url.startsWith("https://upload.test")) {
		if (server.failPuts === 0) return {};
		server.failPuts -= 1;
		return new Response("", { status: 500 });
	}
	if (call.path.endsWith("/config")) return { accounts: [account] };
	if (call.method === "POST" && call.path.endsWith("/attachments")) {
		const filename = String(call.body?.filename);
		if (server.refuseMints) return refusal(filename);
		server.minted += 1;
		const attachment: ServerAttachment = {
			outboxAttachmentId: `att-${server.minted}`,
			filename,
			contentType: String(call.body?.contentType),
			sizeBytes: Number(call.body?.sizeBytes),
			state: "Pending",
		};
		server.attachments.push(attachment);
		return {
			...toResponse(attachment),
			uploadUrl: `https://upload.test/${attachment.outboxAttachmentId}`,
			uploadExpiresAt: 4_000_000_000,
		};
	}
	if (call.path.endsWith("/complete")) {
		const outboxAttachmentId = call.path.split("/").at(-2);
		const attachment = server.attachments.find(
			(candidate) => candidate.outboxAttachmentId === outboxAttachmentId,
		);
		if (!attachment)
			throw new Error(`completed ${outboxAttachmentId} unminted`);
		attachment.state = "Stored";
		return toResponse(attachment);
	}
	if (
		call.method === "GET" &&
		call.path.endsWith(`/outbox/${OUTBOX_MESSAGE_ID}`)
	) {
		server.linkGeneration += 1;
	}
	if (call.method === "PATCH") {
		if (typeof call.body?.htmlBody === "string") {
			server.htmlBody = call.body.htmlBody;
		}
		const kept = call.body?.attachmentIds;
		if (Array.isArray(kept)) {
			server.attachments = server.attachments.filter((attachment) =>
				kept.includes(attachment.outboxAttachmentId),
			);
		}
	}
	return outboxEntry();
};

let objectUrls = 0;

const mount = async (): Promise<DomHarness> => {
	if (!http) {
		server = freshServer();
		objectUrls = 0;
		mock.method(URL, "createObjectURL", () => {
			objectUrls += 1;
			return `blob:object-${objectUrls}`;
		});
		mock.method(URL, "revokeObjectURL", () => {});
		http = mockFetch(answer);
	}
	const dom = createDomHarness();
	harness = dom;
	dom.renderApp(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(
				ComposeProvider,
				null,
				createElement(ComposeForm, {
					mode: "reply",
					account,
					sourceMessage,
					outboxMessageId: OUTBOX_MESSAGE_ID,
					onDraftCreated: () => {},
					onClose: () => {},
				}),
			),
		}),
	);
	await dom.flush();
	await dom.waitFor(
		() =>
			dom
				.query("[data-testid=compose-body]")
				?.textContent?.includes("Here it is") === true,
		"the draft to load into the writing surface",
		30_000,
	);
	return dom;
};

const bodyOf = (dom: DomHarness): HTMLElement => {
	const body = dom.query("[data-testid=compose-body]");
	if (!body) throw new Error("the compose body is not mounted");
	return body;
};

const attachedRows = (dom: DomHarness): [string, string | null][] =>
	dom
		.queryAll("[data-testid=compose-attachment]")
		.map((row) => [
			row.querySelector("bdi")?.textContent ?? "",
			row.getAttribute("data-state"),
		]);

const rowIn = (dom: DomHarness, state: string): boolean =>
	attachedRows(dom).some(([, seen]) => seen === state);

const png = (name: string): File =>
	new File(["\u0089PNG"], name, { type: "image/png" });

const paste = (dom: DomHarness, files: File[]): void => {
	dom.dispatch(
		bodyOf(dom),
		new ClipboardEventClass("paste", transferOf(files)),
	);
};

const pasteAndStore = async (dom: DomHarness): Promise<void> => {
	paste(dom, [png("chart.png")]);
	await dom.waitFor(() => rowIn(dom, "attached"), "the pasted image to store");
	await dom.wait(AUTOSAVE_DEBOUNCE_MS + 200);
};

describe("a file pasted or dropped into the composer (#1307)", () => {
	it("puts a pasted image in the body, referred to by the content-id it was stored under", async () => {
		const dom = await mount();

		await pasteAndStore(dom);

		assert.deepEqual(attachedRows(dom), [["chart.png", "attached"]]);
		assert.equal(
			bodyOf(dom).querySelector("img")?.getAttribute("src"),
			"blob:object-1",
			"the composer does not show the picture it was handed",
		);
		assert.ok(
			server.htmlBody.includes('src="cid:att-1@remit"'),
			`the saved body does not refer to the stored image: ${server.htmlBody}`,
		);
	});

	it("shows the stored picture again when the draft is reopened", async () => {
		await pasteAndStore(await mount());
		harness?.close();

		const reopened = await mount();
		await reopened.waitFor(
			() =>
				bodyOf(reopened).querySelector("img")?.getAttribute("src") ===
				"blob:object-2",
			"the reopened draft to resolve its picture",
		);

		assert.ok(
			http?.calls.some((call) => call.url.startsWith(`${CONTENT_HOST}/att-1?`)),
			"the picture was not read back from where the file is stored",
		);
		assert.deepEqual(attachedRows(reopened), [["chart.png", "attached"]]);
	});

	it("never saves a picture whose file was removed, even after an undo", async () => {
		await pasteAndStore(await mount());
		harness?.close();

		const reopened = await mount();
		await reopened.waitFor(
			() =>
				bodyOf(reopened).querySelector("img")?.getAttribute("src") ===
				"blob:object-2",
			"the reopened draft to resolve its picture",
		);
		reopened.click(reopened.byLabel("Remove chart.png"));
		await reopened.waitFor(
			() => bodyOf(reopened).querySelector("img") === null,
			"the removed file's picture to leave the body",
		);
		reopened.dispatch(
			bodyOf(reopened),
			new reopened.window.KeyboardEvent("keydown", {
				key: "z",
				code: "KeyZ",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		await reopened.wait(AUTOSAVE_DEBOUNCE_MS + 200);

		assert.equal(
			server.htmlBody.includes("cid:att-1@remit"),
			false,
			server.htmlBody,
		);
		assert.equal(
			bodyOf(reopened).querySelector("img"),
			null,
			"a picture is on screen for a file the draft no longer carries",
		);
	});

	it("renews an expired picture link and shows the picture", async () => {
		await pasteAndStore(await mount());
		harness?.close();
		server.expireBefore = server.linkGeneration + 2;

		const reopened = await mount();
		await reopened.waitFor(
			() =>
				bodyOf(reopened).querySelector("img")?.getAttribute("src") ===
				"blob:object-2",
			"the renewed link to resolve the picture",
		);

		const reads = (http?.calls ?? []).filter((call) =>
			call.url.startsWith(`${CONTENT_HOST}/att-1?`),
		);
		assert.equal(
			reads.length,
			2,
			"the expired link was not read, then renewed",
		);
	});

	it("says the session ended when the picture is refused for authentication", async () => {
		await pasteAndStore(await mount());
		harness?.close();
		server.contentStatus = 401;

		const reopened = await mount();
		await reopened.waitFor(
			() => reopened.text().includes("Your session expired"),
			"the signed-out notice",
		);

		assert.match(reopened.text(), /Sign in again/);
	});

	it("keeps a retried pasted image inline once its upload goes through", async () => {
		const dom = await mount();
		server.failPuts = 1;

		paste(dom, [png("chart.png")]);
		await dom.waitFor(() => rowIn(dom, "failed"), "the upload to fail");
		await dom.waitFor(
			() => bodyOf(dom).querySelector("img") === null,
			"the failed picture to leave the body",
		);
		dom.click(dom.byText("button", "Try again"));
		await dom.waitFor(() => rowIn(dom, "attached"), "the retry to store");
		await dom.wait(AUTOSAVE_DEBOUNCE_MS + 200);

		assert.ok(
			bodyOf(dom).querySelector("img"),
			"the retried picture is not in the body",
		);
		assert.ok(
			server.htmlBody.includes('src="cid:att-2@remit"'),
			`the saved body does not refer to the retried image: ${server.htmlBody}`,
		);
	});

	it("takes a refused image back out of the body and says why on its row", async () => {
		const dom = await mount();
		server.refuseMints = true;

		paste(dom, [png("huge.png")]);
		await dom.waitFor(() => rowIn(dom, "failed"), "the refusal to land");
		await dom.waitFor(
			() => bodyOf(dom).querySelector("img") === null,
			"the refused picture to leave the body",
		);
		await dom.wait(AUTOSAVE_DEBOUNCE_MS + 200);

		assert.match(
			dom.query("[data-testid=compose-attachment-error]")?.textContent ?? "",
			/huge\.png/,
		);
		assert.equal(server.htmlBody.includes("<img"), false, server.htmlBody);
	});

	it("takes the picture out of the body when its file is removed", async () => {
		const dom = await mount();
		await pasteAndStore(dom);

		dom.click(dom.byLabel("Remove chart.png"));
		await dom.waitFor(
			() => bodyOf(dom).querySelector("img") === null,
			"the removed file's picture to leave the body",
		);
		await dom.wait(AUTOSAVE_DEBOUNCE_MS + 200);

		assert.deepEqual(attachedRows(dom), []);
		assert.equal(server.htmlBody.includes("cid:"), false, server.htmlBody);
	});

	it("attaches a pasted file that is not a picture, leaving the body alone", async () => {
		const dom = await mount();

		paste(dom, [
			new File(["%PDF"], "minutes.pdf", { type: "application/pdf" }),
		]);
		await dom.waitFor(
			() => rowIn(dom, "attached"),
			"the pasted file to attach",
		);

		assert.deepEqual(attachedRows(dom), [["minutes.pdf", "attached"]]);
		assert.equal(bodyOf(dom).querySelector("img"), null);
	});

	it("attaches a dropped file the way the picker does, leaving the body alone", async () => {
		const dom = await mount();
		const area = dom.query("[data-testid=compose-body-area]");
		if (!area) throw new Error("the compose body area is not mounted");

		const drop = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", {
			value: transferOf([
				new File(["%PDF"], "minutes.pdf", { type: "application/pdf" }),
			]),
		});
		dom.dispatch(area, drop);
		await dom.waitFor(
			() => rowIn(dom, "attached"),
			"the dropped file to attach",
		);

		assert.deepEqual(attachedRows(dom), [["minutes.pdf", "attached"]]);
		assert.equal(drop.defaultPrevented, true, "the browser opened the file");
		assert.equal(
			bodyOf(dom).querySelector("img"),
			null,
			"a dropped file went into the body",
		);
	});
});
