import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import type {
	RemitImapCalendarResponse,
	RemitImapCalendarSuggestionResponse,
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { type IntelligenceData, IntelligencePanel } from "@remit/ui";
import {
	type AnyRouter,
	createMemoryHistory,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { useReplyWithText } from "@/components/compose/reply-with-times";
import { useIntelligenceCalendar } from "@/hooks/useIntelligenceCalendar";
import { noopTelemetry } from "@/lib/telemetry";
import { createAppRouter } from "@/router";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import {
	makeAccount,
	makeMailbox,
	makeThreadMessage,
} from "@/test-support/fixtures";
import { type HttpCall, type HttpMock, mockFetch } from "@/test-support/http";
import { ConversationView } from "./ConversationView";

const ACCOUNT_ID = "acc-1";
const MAILBOX_ID = "mbx-inbox";
const THREAD_ID = "thread-1";
const MESSAGE_ID = "msg-1";
const OTHER_ID = "msg-2";
const DRAFT_ID = "ob-times";
const CALENDAR = "11111111-1111-4111-8111-111111111111";
const SUGGESTION = "22222222-2222-4222-8222-222222222222";
const AUTOSAVE_DEBOUNCE_MS = 2000;

const account = makeAccount({
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	username: "me@example.com",
	smtpUsername: "me@example.com",
});

const inbox = makeMailbox({
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	fullPath: "INBOX",
});

const thread: RemitImapThreadMessageResponse = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	subject: "Quarterly review",
	fromName: "Organizer",
	fromEmail: "organizer@example.test",
	isRead: true,
});

const otherThread: RemitImapThreadMessageResponse = {
	...thread,
	messageId: OTHER_ID,
};

const describeMessage: RemitImapDescribeMessageResponse = {
	message: {
		messageId: MESSAGE_ID,
		mailboxId: MAILBOX_ID,
		uid: 1,
		rfc822Size: 512,
		internalDate: 1_767_225_600_000,
		status: "active",
		syncStatus: "pending",
		abandonedMutation: "none",
	},
	envelope: {
		messageId: MESSAGE_ID,
		date: 1_767_225_600_000,
		subject: "Quarterly review",
		messageIdValue: "<review-1@example.test>",
		from: [
			{
				addressId: "addr-organizer",
				displayName: "Organizer",
				normalizedEmail: "organizer@example.test",
				addressRole: "from",
				addressOrder: 0,
			},
		],
		to: [
			{
				addressId: "addr-me",
				normalizedEmail: "me@example.com",
				addressRole: "to",
				addressOrder: 0,
			},
		],
		cc: [],
		bcc: [],
		replyTo: [],
		category: "uncategorized",
		senderTrust: "unknown",
	},
	flags: ["\\Seen"],
	bodyParts: [],
	references: [],
};

const calendars = [
	{
		calendarId: CALENDAR,
		accountConfigId: "cfg-1",
		urlSegment: "default",
		displayName: "Personal",
		color: "Cal2",
		componentSet: "VeventOnly",
		source: "Default",
		timezone: "Europe/Amsterdam",
		syncSequence: 1,
		subscriptionUrl: "",
		subscriptionEnabled: false,
		subscriptionCheckedAt: 0,
		subscriptionFetchedAt: 0,
		subscriptionError: "",
		createdAt: 0,
		updatedAt: 0,
	},
] satisfies RemitImapCalendarResponse[];

const invitation: RemitImapCalendarSuggestionResponse = {
	suggestionId: SUGGESTION,
	accountConfigId: "cfg-1",
	messageId: MESSAGE_ID,
	bodyPartId: "part-1",
	icalUid: "uid-1",
	sequence: 0,
	method: "Request",
	source: "IcalendarPart",
	state: "Pending",
	summary: "Quarterly review",
	dtStart: "2026-09-01T08:00:00+00:00",
	dtEnd: "2026-09-01T09:00:00+00:00",
	allDay: false,
	location: "",
	organizer: "organizer@example.test",
	zoneCertainty: "Explicit",
	acceptedCalendarObjectId: "",
	createdAt: 0,
	updatedAt: 0,
};

const sender: IntelligenceData = {
	sender: {
		name: "Organizer",
		email: "organizer@example.test",
		trust: "wellknown",
		firstSeenLabel: "Jan 2025",
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "example.test",
		summary: "Signed by example.test.",
	},
	category: { value: "personal" },
	similar: [],
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

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

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const MESSAGE_PATH = `/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`;

const describeOther: RemitImapDescribeMessageResponse = {
	...describeMessage,
	message: { ...describeMessage.message, messageId: OTHER_ID, uid: 2 },
	envelope: {
		...describeMessage.envelope,
		messageId: OTHER_ID,
		messageIdValue: "<review-2@example.test>",
	},
};

const CalendarRail = ({
	railThread,
}: {
	railThread: RemitImapThreadMessageResponse;
}) => {
	const calendar = useIntelligenceCalendar(railThread, useReplyWithText());
	return createElement(IntelligencePanel, {
		data: sender,
		calendar: calendar.surface,
		tab: calendar.tab,
		onTabChange: calendar.onTabChange,
	});
};

const Surface = ({
	railThread,
}: {
	railThread: RemitImapThreadMessageResponse;
}) =>
	createElement(
		ComposeProvider,
		null,
		createElement(ConversationView, {
			threadId: THREAD_ID,
			mailboxId: MAILBOX_ID,
			subject: "Quarterly review",
			selectedMessageId: MESSAGE_ID,
		}),
		createElement(CalendarRail, { railThread }),
	);

const savedDraft = {
	outboxMessageId: DRAFT_ID,
	accountId: ACCOUNT_ID,
	fromAddress: "me@example.com",
	toAddresses: ["organizer@example.test"],
	ccAddresses: [],
	bccAddresses: [],
	attachments: [],
	references: [],
	subject: "Re: Quarterly review",
	textBody: "See you then",
	htmlBody: "<p>See you then</p>",
	status: "draft",
};

const creates = (): HttpCall[] =>
	(http?.calls ?? []).filter(
		(call) => call.method === "POST" && call.path.endsWith("/outbox"),
	);

const mount = async (
	href: string,
	{
		railThread = thread,
		draftArrives = Promise.resolve(),
	}: {
		railThread?: RemitImapThreadMessageResponse;
		draftArrives?: Promise<void>;
	} = {},
): Promise<{ mounted: DomHarness; router: AnyRouter; redraw: () => void }> => {
	let saved: Record<string, unknown> = savedDraft;
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/accounts/${ACCOUNT_ID}/mailboxes`))
			return { items: [inbox] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`))
			return { items: [thread, otherThread] };
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		if (call.path.endsWith(`/messages/${OTHER_ID}`)) return describeOther;
		if (call.path.endsWith(`/messages/${OTHER_ID}/calendar-suggestions`))
			return { items: [{ ...invitation, messageId: OTHER_ID }] };
		if (call.path.endsWith("/calendars")) return { items: calendars };
		if (call.path.endsWith(`/messages/${MESSAGE_ID}/calendar-suggestions`))
			return { items: [invitation] };
		if (call.method === "POST" && call.path.endsWith("/outbox")) {
			saved = {
				...savedDraft,
				...(call.body as Record<string, unknown>),
			};
			return saved;
		}
		if (call.path.endsWith(`/outbox/${DRAFT_ID}`)) {
			await draftArrives;
			return saved;
		}
		return { items: [] };
	});

	const mounted = createDomHarness();
	harness = mounted;
	const router = createAppRouter(
		mounted.queryClient,
		noopTelemetry,
		createMemoryHistory({ initialEntries: [href] }),
	) as unknown as AnyRouter;
	await router.load();
	const redraw = () =>
		mounted.renderApp(
			createElement(RouterContextProvider, {
				router,
				// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
				children: createElement(Surface, { railThread }),
			}),
		);
	redraw();
	await mounted.waitFor(
		() => mounted.text().includes("Offer other times"),
		"the invitation card to be drawn",
	);
	return { mounted, router, redraw };
};

const drawnUntil = async (
	mounted: DomHarness,
	redraw: () => void,
	predicate: () => boolean,
	description: string,
): Promise<void> => {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() > deadline)
			throw new Error(`gave up waiting for ${description}`);
		redraw();
		await mounted.wait(50);
	}
};

const composerText = (mounted: DomHarness): string =>
	mounted.query("[data-testid=compose-body]")?.textContent ?? "";

const plainBody = (mounted: DomHarness): HTMLTextAreaElement | null =>
	mounted.query<HTMLTextAreaElement>("[data-testid=compose-body-plain]");

const freeSlot = (mounted: DomHarness): HTMLElement | undefined =>
	mounted
		.queryAll("button[aria-pressed]")
		.find((button) =>
			/\d{2}:\d{2} – \d{2}:\d{2}/.test(button.textContent ?? ""),
		);

const pickAndReply = async (mounted: DomHarness): Promise<string> => {
	mounted.click(mounted.byText("button", "Offer other times"));
	await mounted.waitFor(
		() => freeSlot(mounted) !== undefined,
		"free half-hours to be offered",
	);
	const slot = freeSlot(mounted);
	assert.ok(slot, "a free half-hour is offered");
	const picked = (slot.textContent ?? "").trim();
	mounted.click(slot);
	await mounted.flush();
	mounted.click(mounted.byText("button", "Reply with these times"));
	return picked;
};

const seedInAddress = (router: AnyRouter): unknown =>
	(router.state.location.search as Record<string, unknown>).body;

describe("offering other times from an invitation", () => {
	it("opens the reply with the picked times written into it", async () => {
		const { mounted, router, redraw } = await mount(MESSAGE_PATH);

		const picked = await pickAndReply(mounted);

		await drawnUntil(
			mounted,
			redraw,
			() => composerText(mounted).includes(picked),
			"the picked time to be written into the reply",
		);
		assert.match(composerText(mounted), /September/);
		assert.equal(router.state.location.pathname, `${MESSAGE_PATH}/reply`);

		await mounted.wait(AUTOSAVE_DEBOUNCE_MS + 300);
		await mounted.waitFor(
			() => creates().length === 1,
			"the reply to be saved as a draft",
		);
		const draft = creates()[0].body as { textBody?: string };
		assert.ok(
			draft.textBody?.includes(picked),
			`the saved draft holds the picked time, got ${JSON.stringify(draft.textBody)}`,
		);

		await drawnUntil(
			mounted,
			redraw,
			() => router.state.location.pathname.endsWith(`/reply/${DRAFT_ID}`),
			"the address to adopt the draft",
		);
		assert.equal(
			seedInAddress(router),
			undefined,
			"once the draft holds the times, the address no longer carries them",
		);
		await drawnUntil(
			mounted,
			redraw,
			() => composerText(mounted).includes(picked),
			"the composer to keep the times once the draft is adopted",
		);
	});

	it("keeps what was typed when the times go into a reply already open", async () => {
		const { mounted, router } = await mount(`${MESSAGE_PATH}/reply`);
		await mounted.waitFor(
			() => mounted.query("[data-testid=compose-mode-toggle]") !== null,
			"the reply composer to open",
			5000,
		);
		const toggle = mounted.query("[data-testid=compose-mode-toggle]");
		assert.ok(toggle);
		mounted.click(toggle);
		await mounted.waitFor(
			() => plainBody(mounted) !== null,
			"the plain writing surface",
		);
		const typing = plainBody(mounted);
		assert.ok(typing);
		mounted.type(typing, "Hi");
		await mounted.flush();

		const picked = await pickAndReply(mounted);

		await mounted.waitFor(
			() => plainBody(mounted)?.value.includes(picked) === true,
			"the picked time to go into the open reply",
		);
		assert.match(plainBody(mounted)?.value ?? "", /^Hi/);
		assert.equal(router.state.location.pathname, `${MESSAGE_PATH}/reply`);
		assert.equal(seedInAddress(router), undefined);
	});

	it("keeps an open reply-all a reply-all and adds the times to it", async () => {
		const href = `${MESSAGE_PATH}/reply-all/${DRAFT_ID}`;
		const { mounted, router } = await mount(href);
		await mounted.waitFor(
			() => composerText(mounted).includes("See you then"),
			"the saved reply-all to reopen",
			5000,
		);

		const picked = await pickAndReply(mounted);

		await mounted.waitFor(
			() => composerText(mounted).includes(picked),
			"the picked time to go into the open reply-all",
		);
		assert.ok(composerText(mounted).includes("See you then"));
		assert.equal(router.state.location.pathname, href);
		assert.equal(seedInAddress(router), undefined);
	});

	it("adds the times to a forward of the same message already open", async () => {
		const href = `${MESSAGE_PATH}/forward`;
		const { mounted, router } = await mount(href);
		await mounted.waitFor(
			() => mounted.query("[data-testid=compose-body]") !== null,
			"the forward to open",
			5000,
		);

		const picked = await pickAndReply(mounted);

		await mounted.waitFor(
			() => composerText(mounted).includes(picked),
			"the picked time to go into the open forward",
		);
		assert.equal(router.state.location.pathname, href);
	});

	it("opens a reply holding the times when the open reply answers another message", async () => {
		const { mounted, router, redraw } = await mount(`${MESSAGE_PATH}/reply`, {
			railThread: otherThread,
		});
		await mounted.waitFor(
			() => mounted.query("[data-testid=compose-body]") !== null,
			"the reply to the first message to open",
			5000,
		);

		const picked = await pickAndReply(mounted);

		await drawnUntil(
			mounted,
			redraw,
			() => composerText(mounted).includes(picked),
			"a reply to the other message holding the times",
		);
		assert.equal(
			router.state.location.pathname,
			`/mail/${MAILBOX_ID}/${THREAD_ID}/${OTHER_ID}/reply`,
		);
	});

	it("adds the times on top of a draft still loading when they were picked", async () => {
		let deliver = () => {};
		const draftArrives = new Promise<void>((resolve) => {
			deliver = resolve;
		});
		const { mounted } = await mount(`${MESSAGE_PATH}/reply-all/${DRAFT_ID}`, {
			draftArrives,
		});

		const picked = await pickAndReply(mounted);
		await mounted.wait(100);
		deliver();

		await mounted.waitFor(
			() =>
				composerText(mounted).includes("See you then") &&
				composerText(mounted).includes(picked),
			"the loaded draft to hold the picked time",
			5000,
		);
	});
});
