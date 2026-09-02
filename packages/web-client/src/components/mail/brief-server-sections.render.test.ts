/**
 * The brief's sections, counts and ordering come from the server (#312).
 *
 * The brief used to be one non-paginated page of the newest 50 unified rows.
 * Every section was a slice of that page, and the number beside a section label
 * was how many of those 50 rows happened to fall in it — rendered where a
 * category total belongs. On the live instance Personal mail is the bottom third
 * of the inbox by recency, so a whole category could sit entirely below the
 * window: the section rendered empty and its header read zero.
 *
 * The seed here is that mailbox in miniature. The unified listing — the request
 * carrying no category — answers with the newest mail only, and Marketing's mail
 * is all older than every row in it. A brief that groups a page finds no
 * Marketing at all; a brief whose sections are their own queries finds it and
 * states its real size.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapMessageCategory,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { SECTION_ROW_CAP } from "@remit/ui";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement, type ReactNode, useEffect, useState } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount, makeThreadMessage } from "@/test-support/fixtures";
import { type HttpCall, type HttpMock, mockFetch } from "@/test-support/http";
import { DailyBrief } from "./DailyBrief";

const ACCOUNT_ID = "acc-1";
const account = makeAccount({ accountId: ACCOUNT_ID });

/** Newest first, the way the server answers. */
const NEWEST = 1_767_225_600_000;
const DAY = 86_400_000;

interface Seed {
	prefix: string;
	category: RemitImapMessageCategory;
	subject: (index: number) => string;
	/** Messages to make. More than the section's page, so the page is a page. */
	messages: number;
	/** Conversations they belong to — fewer than `messages` when mail threads. */
	threads: number;
	/** How far back the newest of them sits. */
	daysAgo: number;
}

const seeded = (seed: Seed): RemitImapThreadMessageResponse[] =>
	Array.from({ length: seed.messages }, (_, index) =>
		makeThreadMessage({
			messageId: `${seed.prefix}-${index}`,
			threadId: `thread-${seed.prefix}-${index % seed.threads}`,
			accountId: ACCOUNT_ID,
			category: seed.category,
			subject: seed.subject(index),
			sentDate: NEWEST - (seed.daysAgo * DAY + index * 1_000),
		}),
	);

/**
 * One conversation, twelve messages. The count is thread-distinct, so this
 * category holds exactly one — and a list keying on messageId renders ten rows
 * under a header reading "1", with the rest of the conversation unreachable
 * because "Show all" is withheld on `1 > 10` being false.
 */
const PERSONAL: Seed = {
	prefix: "personal",
	category: "personal",
	subject: (index) => `Design review, message ${index}`,
	messages: 12,
	threads: 1,
	daysAgo: 0,
};

/** Every one of these is older than every row above, and there are more than fit. */
const MARKETING: Seed = {
	prefix: "marketing",
	category: "marketing",
	subject: (index) => `Spring sale, edition ${index}`,
	messages: 14,
	threads: 12,
	daysAgo: 400,
};

const UNCLASSIFIED: Seed = {
	prefix: "unclassified",
	category: "uncategorized",
	subject: () => "Nothing classified this yet",
	messages: 1,
	threads: 1,
	daysAgo: 10,
};

const SEEDS: Seed[] = [PERSONAL, MARKETING, UNCLASSIFIED];

const ROWS: Record<string, RemitImapThreadMessageResponse[]> =
	Object.fromEntries(SEEDS.map((seed) => [seed.category, seeded(seed)]));

/**
 * What the server would answer `count: true` with: conversations, not messages,
 * over the whole scope rather than the page. Derived from the seed rather than
 * stated, so a header and the rows under it cannot be asserted against two
 * different ideas of what one row is.
 */
const countOf = (category: string): number =>
	new Set((ROWS[category] ?? []).map((row) => row.threadId)).size;

/** The subjects a section's page actually renders, one per conversation. */
const renderedSubjects = (category: string, limit: number): string[] => {
	const page = (ROWS[category] ?? []).slice(0, limit);
	const seen = new Set<string>();
	return page
		.filter((row) => {
			if (seen.has(row.threadId)) return false;
			seen.add(row.threadId);
			return true;
		})
		.map((row) => row.subject ?? "");
};

/**
 * The two matches a search has to order against each other: an old newsletter
 * and a mail from this morning that is not a newsletter. Newest first, the way
 * the server answers.
 */
const searchMatches = [
	...seeded({
		prefix: "match-new",
		category: "automated",
		subject: () => "Your build passed",
		messages: 1,
		threads: 1,
		daysAgo: 0,
	}),
	...seeded({
		prefix: "match-old",
		category: "newsletter",
		subject: () => "Weekly digest for you",
		messages: 1,
		threads: 1,
		daysAgo: 300,
	}),
];

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const paramsOf = (call: HttpCall): URLSearchParams =>
	new URL(call.url, "http://localhost").searchParams;

/** Every `/threads` request, split by what it asked for. */
const threadRequests = (): HttpCall[] =>
	(http?.calls ?? []).filter(
		(call) => new URL(call.url, "http://localhost").pathname === "/threads",
	);

const countRequests = (): HttpCall[] =>
	threadRequests().filter((call) => paramsOf(call).get("count") === "true");

const rowRequests = (): HttpCall[] =>
	threadRequests().filter((call) => paramsOf(call).get("count") !== "true");

/**
 * The field being typed into. A keypress moves `searchInput` and leaves
 * `searchQuery` where it was, which is the state every request must ignore.
 * Driven by an event so the update lands inside the harness's `act`.
 */
const TYPED = "test:typed";

function BriefUnderTest({ search }: { search: string }) {
	const [input, setInput] = useState(search);
	useEffect(() => {
		const onTyped = (event: Event) => {
			setInput((event as CustomEvent<string>).detail);
		};
		window.addEventListener(TYPED, onTyped);
		return () => window.removeEventListener(TYPED, onTyped);
	}, []);
	return brief(search, input);
}

const context = (search: string, input: string): MailContextValue => ({
	accounts: [account],
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
	searchQuery: search,
	searchInput: input,
	searchViewKey: "brief",
	onSearchChange: () => undefined,
	onSearchClear: () => undefined,
	onSearchClearQuery: () => undefined,
	intelligenceOpen: false,
	onToggleIntelligence: () => undefined,
	onRaiseIntelligence: () => undefined,
});

const brief = (search: string, input: string): ReactNode =>
	createElement(MailFreshnessProvider, {
		accountIds: [ACCOUNT_ID],
		// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
		children: createElement(
			MailContext.Provider,
			{ value: context(search, input) },
			createElement(DailyBrief, {
				accounts: [account],
				onDeleteMessages: () => undefined,
			}),
		),
	});

const testRouter = (search: string): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(ComposeProvider, null, createElement(Outlet)),
	});
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (query: Record<string, unknown>) => query,
		component: Outlet,
	});
	// Present so the hooks that name it have the route the generated tree gives
	// them.
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		component: Outlet,
	});
	const briefRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/brief",
		component: () => createElement(BriefUnderTest, { search }),
	});
	const threadRoute = createRoute({
		getParentRoute: () => briefRoute,
		path: "$threadId",
		component: Outlet,
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
		component: Outlet,
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			mailboxRoute,
			briefRoute.addChildren([threadRoute.addChildren([messageRoute])]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/mail/brief"] }),
	}) as unknown as AnyRouter;
};

/** Answer this call instead of the seed, or `undefined` to let the seed answer. */
type Interception = (call: HttpCall) => unknown;

const mountWith = async (
	intercept: Interception,
	search = "",
): Promise<DomHarness> => {
	http = mockFetch((call) => {
		const intercepted = intercept(call);
		if (intercepted !== undefined) return intercepted;
		const url = new URL(call.url, "http://localhost");
		if (url.pathname.endsWith("/config")) return { accounts: [account] };
		if (url.pathname !== "/threads") return { items: [] };
		const params = url.searchParams;
		const categories = params.getAll("category");
		// Search mode: one request, and the server answers with the whole match
		// set in one order.
		if (params.get("query")) return { items: searchMatches };
		// The count is over the whole scope and counts conversations; the rows are
		// a page of messages. Answering the way the server does is what makes the
		// two units visible to the assertions below.
		if (params.get("count") === "true") {
			return {
				items: [],
				count: categories.reduce((sum, category) => sum + countOf(category), 0),
			};
		}
		// A request naming no category is the unified listing the brief used to be:
		// it answers with the newest mail, and Marketing is nowhere in it.
		const rows =
			categories.length === 0
				? (ROWS.personal ?? [])
				: categories.flatMap((category) => ROWS[category] ?? []);
		const limit = Number(params.get("limit") ?? rows.length);
		return { items: rows.slice(0, limit) };
	});

	const router = testRouter(search);
	await router.load();
	const dom = createDomHarness({ viewportWidth: 1400 });
	harness = dom;
	dom.renderApp(createElement(RouterProvider, { router }));
	await dom.flush();
	await dom.wait(20);
	await dom.flush();
	return dom;
};

const mount = (search = ""): Promise<DomHarness> =>
	mountWith(() => undefined, search);

/**
 * Type into the field without submitting: the live input moves, the committed
 * query does not.
 */
const typeWithoutSubmitting = async (
	dom: DomHarness,
	value: string,
): Promise<void> => {
	dom.dispatch(
		dom.window,
		new dom.window.CustomEvent(TYPED, { detail: value }),
	);
	await dom.flush();
	await dom.wait(20);
	await dom.flush();
};

const settled = async (mounted: DomHarness, text: string): Promise<void> => {
	await mounted.waitFor(
		() => mounted.text().includes(text),
		`the brief to render ${text}`,
	);
};

describe("the brief's sections come from the server (#312)", () => {
	// The regression. Marketing's mail is entirely older than the newest unified
	// rows, so a brief that groups a shared page renders this section empty above
	// a header reading zero.
	it("renders a category whose mail is all older than the newest unified rows", async () => {
		const mounted = await mount();
		await settled(mounted, renderedSubjects("marketing", SECTION_ROW_CAP)[0]);

		const shown = mounted.text();
		for (const subject of renderedSubjects("marketing", SECTION_ROW_CAP)) {
			assert.ok(shown.includes(subject), `the section lost ${subject}`);
		}
		assert.ok(
			!rowRequests().some(
				(call) => paramsOf(call).getAll("category").length === 0,
			),
			"the brief still asked for one unified page of everything",
		);
	});

	it("states the category's real size, not the number of rows it loaded", async () => {
		const mounted = await mount();
		await settled(mounted, renderedSubjects("marketing", SECTION_ROW_CAP)[0]);

		const marketing = mounted.byText("button", "Marketing");
		assert.match(
			marketing.textContent ?? "",
			new RegExp(String(countOf("marketing"))),
			"the Marketing header stated its page length instead of its category",
		);
		assert.ok(
			mounted.text().includes(`Show all ${countOf("marketing")}`),
			"the section offered no way to the rest of the category",
		);
	});

	// The count is thread-distinct (`countThreadsInScope`); the page is messages.
	// One twelve-message conversation is therefore one row under a header reading
	// one — not ten rows under it, with the rest of the conversation behind a
	// "Show all" the component withholds because `1 > 10` is false.
	it("renders one row per conversation, the unit the count is in", async () => {
		assert.equal(
			countOf("personal"),
			1,
			"the seed stopped being one conversation",
		);
		const mounted = await mount();
		await settled(mounted, PERSONAL.subject(0));

		const personal = mounted.byText("button", "Personal");
		assert.match(personal.textContent ?? "", /1/);

		const shown = mounted.text();
		const rowsRendered = Array.from({ length: PERSONAL.messages }, (_, index) =>
			PERSONAL.subject(index),
		).filter((subject) => shown.includes(subject));
		assert.deepEqual(
			rowsRendered,
			[PERSONAL.subject(0)],
			"one conversation rendered as several rows, under a header reading one",
		);
		// Marketing holds more than its page and offers the rest; Personal does not
		// and must not, because its one conversation is the whole of it.
		assert.equal(
			(shown.match(/Show all/g) ?? []).length,
			1,
			"a section holding its whole category offered more of it",
		);
	});

	it("asks each section for its own category, newest first", async () => {
		const mounted = await mount();
		await settled(mounted, renderedSubjects("marketing", SECTION_ROW_CAP)[0]);

		const asked = rowRequests().map((call) => ({
			categories: paramsOf(call).getAll("category"),
			order: paramsOf(call).get("order"),
			limit: paramsOf(call).get("limit"),
		}));
		assert.deepEqual(
			asked.flatMap((request) => request.categories).sort(),
			[
				"automated",
				"marketing",
				"newsletter",
				"personal",
				"social",
				"transactional",
				"uncategorized",
			],
			"the brief did not ask once per category",
		);
		for (const request of asked) {
			assert.equal(request.order, "desc");
			assert.equal(request.limit, "10");
		}
	});

	// One count per displayed section, keyed on the criteria alone: no cursor, no
	// limit, so nothing about paging can ask for another.
	it("counts each displayed section once, over the whole scope", async () => {
		const mounted = await mount();
		await settled(mounted, renderedSubjects("marketing", SECTION_ROW_CAP)[0]);

		const counts = countRequests();
		assert.equal(counts.length, 7, "a section was counted more than once");
		for (const call of counts) {
			const params = paramsOf(call);
			assert.equal(params.get("results"), "false");
			assert.equal(params.get("continuationToken"), null);
			assert.equal(params.get("limit"), null);
		}

		const before = counts.length;
		await mounted.flush();
		await mounted.wait(20);
		await mounted.flush();
		assert.equal(
			countRequests().length,
			before,
			"a re-render asked for the counts again",
		);
	});

	// D6 / issue #45: `uncategorized` is the pending state's name, and it has its
	// own section under its own label — never folded into Personal.
	it("renders uncategorized mail as its own Unclassified section", async () => {
		const mounted = await mount();
		await settled(mounted, "Nothing classified this yet");

		const shown = mounted.text();
		assert.ok(shown.includes("Unclassified"));
		const unclassifiedAt = shown.indexOf("Nothing classified this yet");
		const personalAt = shown.indexOf(PERSONAL.subject(0));
		assert.ok(
			personalAt < unclassifiedAt,
			"Unclassified was folded into Personal",
		);
	});

	// Ordering across the seeded windows: the display order is the section order,
	// and within a section it is the order the server answered in. Nothing here
	// re-sorts two truncated lists against each other.
	it("orders sections by display order and rows by the server's answer", async () => {
		const marketing = renderedSubjects("marketing", SECTION_ROW_CAP);
		const mounted = await mount();
		await settled(mounted, marketing[0]);

		const shown = mounted.text();
		const at = (text: string) => shown.indexOf(text);
		assert.ok(
			at(PERSONAL.subject(0)) < at(marketing[0]),
			"Personal did not come before Marketing",
		);
		for (let i = 1; i < marketing.length; i += 1) {
			assert.ok(
				at(marketing[i - 1]) < at(marketing[i]),
				"the section reordered the rows the server returned",
			);
		}
	});

	// Seven requests, seven answers. A request that never got one states itself
	// where that category would have been; the six that came back stay on screen.
	//
	// A transport failure, not a 5xx: the fail-fast contract escalates every 5xx
	// to the full-screen overlay and there is no opt-out here, so a 500 would
	// never reach this state in the app however this test is mounted (#1059).
	it("keeps the other sections when one category's request fails", async () => {
		const dom = await mountWith((call) => {
			const params = new URL(call.url, "http://localhost").searchParams;
			if (!params.getAll("category").includes("marketing")) return undefined;
			throw new TypeError("fetch failed");
		});
		await settled(dom, PERSONAL.subject(0));

		const shown = dom.text();
		assert.ok(
			shown.includes("Couldn't load Marketing"),
			"the failed section said nothing about failing",
		);
		assert.ok(
			shown.includes(PERSONAL.subject(0)),
			"one category's failure blanked a healthy section",
		);
		assert.ok(
			shown.includes("Nothing classified this yet"),
			"one category's failure blanked a healthy section",
		);
	});

	// A total is withheld whenever something narrows the rows after they arrive —
	// here a muted sender. The number goes; the way out of the section must not,
	// or the rest of the category is unreachable.
	it("keeps the way to the whole category when the total is withheld", async () => {
		const dom = await mountWith((call) => {
			const params = new URL(call.url, "http://localhost").searchParams;
			if (params.get("count") === "true") return undefined;
			if (!params.getAll("category").includes("marketing")) return undefined;
			const page = (ROWS.marketing ?? []).slice(0, SECTION_ROW_CAP);
			return {
				items: page.map((row, index) =>
					index === 0 ? { ...row, muted: true } : row,
				),
			};
		});
		await settled(dom, renderedSubjects("marketing", SECTION_ROW_CAP)[1]);

		const marketing = dom.byText("button", "Marketing");
		assert.doesNotMatch(
			marketing.textContent ?? "",
			new RegExp(String(countOf("marketing"))),
			"a count taken with a muted sender in it was stated as the section's size",
		);
		assert.ok(
			dom.text().includes("Show all"),
			"withholding the number stranded the reader in the section",
		);
	});

	// The requests are built from committed state. Typing is not committing: a
	// half-written `is:unread` must tick its chip and move nothing else, or every
	// keystroke on the way to it fires seven section requests and seven counts.
	it("issues no request for a query that has not been submitted", async () => {
		const dom = await mount();
		await settled(dom, renderedSubjects("marketing", SECTION_ROW_CAP)[0]);
		const before = threadRequests().length;

		await typeWithoutSubmitting(dom, "is:unread");

		assert.equal(
			threadRequests().length,
			before,
			"the search field being typed into reached the request criteria",
		);
	});

	// The reading that sent the user here: searching the brief put an old
	// newsletter above a mail from this morning, because the category sections
	// ordered the matches by category first and recency second.
	it("answers a search as one flat list, newest first across categories", async () => {
		const mounted = await mount("digest");
		await settled(mounted, "Weekly digest for you");

		const shown = mounted.text();
		assert.ok(
			shown.indexOf("Your build passed") <
				shown.indexOf("Weekly digest for you"),
			"an old newsletter still outranked a newer match",
		);
		for (const label of ["Newsletter", "Automated", "Personal"]) {
			assert.ok(
				!shown.includes(label),
				`the search kept the ${label} section header`,
			);
		}
		assert.equal(
			mounted.queryAll('button[aria-expanded="true"]').length,
			0,
			"the search rendered a section header",
		);
	});

	it("asks for a search once, with no category scope of its own", async () => {
		const mounted = await mount("digest");
		await settled(mounted, "Weekly digest for you");

		const searched = threadRequests().filter((call) =>
			paramsOf(call).get("query"),
		);
		assert.equal(searched.length, 1, "the search fanned out over categories");
		assert.deepEqual(paramsOf(searched[0]).getAll("category"), []);
		assert.equal(paramsOf(searched[0]).get("order"), "desc");
		assert.equal(
			countRequests().length,
			0,
			"a search asked for section counts it does not render",
		);
	});

	// A token with a server parameter is a parameter, not a pass over the rows:
	// `is:unread` narrows every section's query rather than the ten rows it got.
	it("sends a search token that has a server parameter as one", async () => {
		const mounted = await mount("is:unread");
		await settled(mounted, renderedSubjects("marketing", SECTION_ROW_CAP)[0]);

		const unread = threadRequests().filter(
			(call) => paramsOf(call).get("unread") === "true",
		);
		assert.ok(unread.length > 0, "is:unread never reached the server");
		assert.ok(
			unread.some((call) =>
				paramsOf(call).getAll("category").includes("marketing"),
			),
			"the token did not travel with the section's own category",
		);
	});
});
