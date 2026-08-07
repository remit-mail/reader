/**
 * Issue #604: two seconds after a reply was sent, the draft editor fired one
 * more autosave PATCH at the outbox entry the send had just moved out of draft,
 * and the fatal-error overlay went up over a message that had gone out fine.
 *
 * `handleSend` already dropped the pending autosave timer, but the autosave
 * effect reschedules whenever the save mutation settles — and the last PATCH of
 * a typing burst settles after the send request has left. So the guarantee
 * asserted here is about the entry, not the timer: once it has been sent,
 * nothing writes to it again.
 *
 * The second case is the same rule met from the other side. Send pressed before
 * the first autosave has run has no draft to send, so compose creates one and
 * then sends it — and creating it as already-queued makes that send a second
 * dispatch, which the server refuses.
 *
 * Issue #674 is the boundary between the two: pressing Send inside the two
 * seconds the debounce is still counting down. The cancelled timer was carrying
 * the last edits, and the entry went out as the server last saw it. So the send
 * writes what is on screen first, and a write that fails takes the send with it
 * rather than transmitting the older copy behind the user's back.
 *
 * The stub holds the outbox rule the API holds: only a draft accepts a send.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { createElement, useEffect } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { ComposeForm } from "./ComposeForm";
import { ComposeProvider, useCompose } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1";
const OUTBOX_MESSAGE_ID = "ob-604";
const AUTOSAVE_DEBOUNCE_MS = 2000;

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

const sourceMessage = {
	message: { messageId: "msg-1" },
	envelope: {
		subject: "Lunch",
		messageIdValue: "<m1@example.com>",
		from: [{ normalizedEmail: "them@example.com", displayName: "Them" }],
		replyTo: [],
		to: [],
		cc: [],
	},
	references: [],
	bodyParts: [],
} as unknown as RemitImapDescribeMessageResponse;

const outboxEntry = (status: string) => ({
	outboxMessageId: OUTBOX_MESSAGE_ID,
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["them@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Re: Lunch",
	textBody: "yes",
	status,
});

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let closed = 0;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	closed = 0;
});

const callsTo = (suffix: string) =>
	(http?.calls ?? []).filter((call) => call.path.endsWith(suffix));

const patches = () =>
	(http?.calls ?? []).filter((call) => call.method === "PATCH");

const patchCount = (): number => patches().length;

const patchesAfterTheSend = (): number => {
	const calls = http?.calls ?? [];
	const sendIndex = calls.findIndex((call) => call.path.endsWith("/send"));
	if (sendIndex === -1) throw new Error("the send never went out");
	return calls.slice(sendIndex + 1).filter((call) => call.method === "PATCH")
		.length;
};

const Opened = ({ outboxMessageId }: { outboxMessageId?: string }) => {
	const { state, openCompose } = useCompose();

	useEffect(() => {
		openCompose({ mode: "reply", account, sourceMessage, outboxMessageId });
	}, [openCompose, outboxMessageId]);

	if (!state.isOpen) return null;

	return createElement(ComposeForm, {
		mode: "reply",
		account,
		sourceMessage,
		onClose: () => {
			closed += 1;
		},
	});
};

interface MountOptions {
	/** The draft compose opens on, when the user is resuming one. */
	outboxMessageId?: string;
	/** Hold the PATCH response open so a save is still in flight at send time. */
	gatePatch?: boolean;
	/** Refuse every PATCH, so the write compose makes before sending fails. */
	failPatch?: boolean;
}

const mount = async (
	options: MountOptions = {},
): Promise<{ releasePatch: () => void }> => {
	let release = (): void => {};
	const patchGate = options.gatePatch
		? new Promise<void>((resolve) => {
				release = resolve;
			})
		: Promise.resolve();

	let status = options.outboxMessageId ? "draft" : "absent";

	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };

		if (call.method === "POST" && call.path.endsWith("/outbox")) {
			status = call.body?.sendImmediately === true ? "queued" : "draft";
			return outboxEntry(status);
		}

		if (call.path.endsWith("/send")) {
			if (status !== "draft") {
				return httpError(409, `This message is already ${status}.`);
			}
			status = "queued";
			return outboxEntry(status);
		}

		if (call.method === "PATCH") {
			await patchGate;
			if (options.failPatch) return httpError(409, "The draft moved on.");
			return outboxEntry(status);
		}

		return outboxEntry(status);
	});

	harness = createDomHarness();
	harness.renderApp(
		createElement(
			ComposeProvider,
			null,
			createElement(Opened, { outboxMessageId: options.outboxMessageId }),
		),
	);
	await harness.flush();
	await harness.wait(50);

	return { releasePatch: release };
};

const subjectField = (): HTMLElement => {
	const field = harness?.query("[data-subject-field]");
	if (!field) throw new Error("the compose subject field is not mounted");
	return field;
};

const sendButton = (): HTMLElement => {
	const button = harness?.byText("button", "Send");
	if (!button) throw new Error("the compose send button is not mounted");
	return button;
};

describe("compose and the outbox entry it is sending (#604, #674)", () => {
	it("writes no further PATCH to an entry once it has been sent", async () => {
		const { releasePatch } = await mount({
			outboxMessageId: OUTBOX_MESSAGE_ID,
			gatePatch: true,
		});

		harness?.type(subjectField(), "Re: Lunch tomorrow");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 100);
		assert.equal(patchCount(), 1, "the typing burst autosaves once");

		harness?.click(sendButton());
		await harness?.flush();

		// The autosave that was still in flight settles after the send, which is
		// what used to re-arm the debounce.
		releasePatch();
		await harness?.flush();
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 200);

		assert.equal(callsTo("/send").length, 1, "the send went out");
		assert.equal(patchesAfterTheSend(), 0, "no write followed the send");
		// The in-flight autosave and the write before the send are the two, in
		// that order: a second write issued alongside the first could land behind
		// it and put the older body back.
		assert.equal(
			patchCount(),
			2,
			"the two writes went out one after the other",
		);
	});

	it("writes the edit made inside the debounce window before it sends", async () => {
		await mount({ outboxMessageId: OUTBOX_MESSAGE_ID });

		harness?.type(subjectField(), "Re: Lunch tomorrow");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 100);
		assert.equal(patchCount(), 1, "the typing burst autosaves once");

		// Inside the two seconds the next autosave would have waited.
		harness?.type(subjectField(), "Re: Lunch on Thursday");
		harness?.click(sendButton());
		await harness?.flush();
		await harness?.wait(100);

		assert.equal(callsTo("/send").length, 1, "the send went out");
		const written = patches().at(-1);
		assert.equal(
			written?.body?.subject,
			"Re: Lunch on Thursday",
			"the entry carries the edit the debounce was still holding",
		);
		// Autosave never writes these, so an entry autosaved before Send used to
		// go out unchained from the message it replies to.
		assert.equal(written?.body?.inReplyTo, "<m1@example.com>");
		assert.deepEqual(written?.body?.references, ["<m1@example.com>"]);
		assert.equal(closed, 1, "compose closed on a successful send");
	});

	it("sends nothing, and says so, when that write fails", async () => {
		await mount({ outboxMessageId: OUTBOX_MESSAGE_ID, failPatch: true });

		harness?.type(subjectField(), "Re: Lunch on Thursday");
		harness?.click(sendButton());
		await harness?.flush();
		await harness?.wait(100);

		assert.equal(patchCount(), 1, "the write was attempted");
		assert.equal(callsTo("/send").length, 0, "the older copy stayed put");
		assert.equal(closed, 0, "compose stayed open");
		assert.match(harness?.text() ?? "", /Couldn't send message/);
	});

	it("dispatches once when Send is pressed twice over the write", async () => {
		const { releasePatch } = await mount({
			outboxMessageId: OUTBOX_MESSAGE_ID,
			gatePatch: true,
		});

		harness?.type(subjectField(), "Re: Lunch on Thursday");
		harness?.click(sendButton());
		harness?.click(sendButton());
		await harness?.flush();

		releasePatch();
		await harness?.flush();
		await harness?.wait(100);

		assert.equal(patchCount(), 1, "the entry was written once");
		assert.equal(callsTo("/send").length, 1, "the message went out once");
		assert.equal(closed, 1, "compose closed on a successful send");
	});

	it("sends a reply pressed before the first autosave, in one dispatch", async () => {
		await mount();

		harness?.click(sendButton());
		await harness?.flush();
		await harness?.wait(100);

		const created = callsTo("/outbox").filter((call) => call.method === "POST");
		assert.equal(created.length, 1, "the message was created once");
		assert.equal(created[0]?.body?.sendImmediately, false);
		assert.equal(callsTo("/send").length, 1, "the send went out");
		assert.equal(closed, 1, "compose closed on a successful send");
	});
});
