import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
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
	createRootRoute,
	createRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement, useState } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { useIntelligenceCalendar } from "@/hooks/useIntelligenceCalendar";
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

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const MESSAGE_PATH = `/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`;

const CalendarRail = () => {
	const calendar = useIntelligenceCalendar(thread);
	return createElement(IntelligencePanel, {
		data: sender,
		calendar: calendar.surface,
		tab: calendar.tab,
		onTabChange: calendar.onTabChange,
	});
};

const RENDER_AGAIN = "Render again";

const Surface = () => {
	const [renders, setRenders] = useState(0);
	return createElement(
		ComposeProvider,
		null,
		createElement(
			"button",
			{
				type: "button",
				"aria-label": RENDER_AGAIN,
				onClick: () => setRenders(renders + 1),
			},
			String(renders),
		),
		createElement(ConversationView, {
			threadId: THREAD_ID,
			mailboxId: MAILBOX_ID,
			subject: "Quarterly review",
			selectedMessageId: MESSAGE_ID,
		}),
		createElement(CalendarRail),
	);
};

const testRouter = (): AnyRouter => {
	const rootRoute = createRootRoute();
	const mailboxRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail/$mailboxId",
		validateSearch: (search: Record<string, unknown>) => search,
	});
	const threadRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "$threadId",
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
	});
	const replyRoute = createRoute({
		getParentRoute: () => messageRoute,
		path: "$mode/{-$outboxMessageId}",
	});
	return createRouter({
		routeTree: rootRoute.addChildren([
			mailboxRoute.addChildren([
				threadRoute.addChildren([messageRoute.addChildren([replyRoute])]),
			]),
		]),
		history: createMemoryHistory({ initialEntries: [MESSAGE_PATH] }),
	}) as unknown as AnyRouter;
};

const creates = (): HttpCall[] =>
	(http?.calls ?? []).filter(
		(call) => call.method === "POST" && call.path.endsWith("/outbox"),
	);

const mount = async (): Promise<{ mounted: DomHarness; router: AnyRouter }> => {
	let saved: Record<string, unknown> = {};
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/accounts/${ACCOUNT_ID}/mailboxes`))
			return { items: [inbox] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`))
			return { items: [thread] };
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		if (call.path.endsWith("/calendars")) return { items: calendars };
		if (call.path.endsWith(`/messages/${MESSAGE_ID}/calendar-suggestions`))
			return { items: [invitation] };
		if (call.method === "POST" && call.path.endsWith("/outbox")) {
			saved = {
				...(call.body as Record<string, unknown>),
				outboxMessageId: DRAFT_ID,
				attachments: [],
				references: [],
				status: "draft",
			};
			return saved;
		}
		if (call.path.endsWith(`/outbox/${DRAFT_ID}`)) return saved;
		return { items: [] };
	});

	const router = testRouter();
	await router.load();
	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(
		createElement(RouterContextProvider, {
			router,
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(Surface),
		}),
	);
	await mounted.waitFor(
		() => mounted.text().includes("Offer other times"),
		"the invitation card to be drawn",
	);
	return { mounted, router };
};

const composerText = (mounted: DomHarness): string =>
	mounted.query("[data-testid=compose-body]")?.textContent ?? "";

const renderUntil = async (
	mounted: DomHarness,
	predicate: () => boolean,
	description: string,
): Promise<void> => {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		mounted.click(mounted.byLabel(RENDER_AGAIN));
		await mounted.wait(50);
		if (predicate()) return;
	}
	throw new Error(`gave up waiting for ${description}`);
};

describe("offering other times from an invitation", () => {
	it("opens the reply with the picked times written into it", async () => {
		const { mounted, router } = await mount();

		mounted.click(mounted.byText("button", "Offer other times"));
		await mounted.waitFor(
			() => mounted.query("[aria-pressed]") !== null,
			"free half-hours to be offered",
		);
		const slot = mounted.query("[aria-pressed]");
		assert.ok(slot, "a free half-hour is offered");
		const picked = (slot.textContent ?? "").trim();
		mounted.click(slot);
		await mounted.flush();

		mounted.click(mounted.byText("button", "Reply with these times"));

		await renderUntil(
			mounted,
			() => composerText(mounted).includes(picked),
			"the picked time to be written into the reply",
		);
		assert.match(composerText(mounted), /September/);
		assert.equal(
			router.state.location.pathname,
			`${MESSAGE_PATH}/reply`,
			"the reply answers the message the invitation came in",
		);

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

		await renderUntil(
			mounted,
			() => router.state.location.pathname.endsWith(`/reply/${DRAFT_ID}`),
			"the address to adopt the draft",
		);
		assert.equal(
			(router.state.location.search as Record<string, unknown>).body,
			undefined,
			"once the draft holds the times, the address no longer carries them",
		);
		await renderUntil(
			mounted,
			() => composerText(mounted).includes(picked),
			"the composer to keep the times once the draft is adopted",
		);
	});
});
