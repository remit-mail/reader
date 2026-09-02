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
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
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

const seeded = (
	prefix: string,
	category: RemitImapMessageCategory,
	subjects: string[],
	oldestFirstDaysAgo: number,
): RemitImapThreadMessageResponse[] =>
	subjects.map((subject, index) =>
		makeThreadMessage({
			messageId: `${prefix}-${index}`,
			threadId: `thread-${prefix}-${index}`,
			accountId: ACCOUNT_ID,
			category,
			subject,
			sentDate: NEWEST - (oldestFirstDaysAgo + index) * DAY,
		}),
	);

/** The newest mail, and the whole of what a unified page would have held. */
const personalRows = seeded(
	"personal",
	"personal",
	["Design review tomorrow", "Lunch Thursday"],
	0,
);

/** Every one of these is older than every row above. */
const marketingRows = seeded(
	"marketing",
	"marketing",
	["Spring sale ends soon", "New arrivals", "One last reminder"],
	400,
);

/**
 * The two matches a search has to order against each other: an old newsletter
 * and a mail from this morning that is not a newsletter. Newest first, the way
 * the server answers.
 */
const searchMatches = [
	...seeded("match-new", "automated", ["Your build passed"], 0),
	...seeded("match-old", "newsletter", ["Weekly digest for you"], 300),
];

const unclassifiedRows = seeded(
	"unclassified",
	"uncategorized",
	["Nothing classified this yet"],
	10,
);

const ROWS: Record<string, RemitImapThreadMessageResponse[]> = {
	personal: personalRows,
	marketing: marketingRows,
	uncategorized: unclassifiedRows,
};

/** What the whole scope holds, which is nothing like what a page holds. */
const TOTALS: Record<string, number> = {
	personal: 4753,
	marketing: 3942,
	uncategorized: 12,
	newsletter: 0,
	transactional: 0,
	social: 0,
	automated: 0,
};

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

const context = (search: string): MailContextValue => ({
	accounts: [account],
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
	searchQuery: search,
	searchInput: search,
	searchViewKey: "brief",
	onSearchChange: () => undefined,
	onSearchClear: () => undefined,
	onSearchClearQuery: () => undefined,
	intelligenceOpen: false,
	onToggleIntelligence: () => undefined,
	onRaiseIntelligence: () => undefined,
});

const brief = (search: string): ReactNode =>
	createElement(MailFreshnessProvider, {
		accountIds: [ACCOUNT_ID],
		// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
		children: createElement(
			MailContext.Provider,
			{ value: context(search) },
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
		component: () => brief(search),
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

const mount = async (search = ""): Promise<DomHarness> => {
	http = mockFetch((call) => {
		const url = new URL(call.url, "http://localhost");
		if (url.pathname.endsWith("/config")) return { accounts: [account] };
		if (url.pathname !== "/threads") return { items: [] };
		const params = url.searchParams;
		const categories = params.getAll("category");
		// Search mode: one request, and the server answers with the whole match
		// set in one order.
		if (params.get("query")) return { items: searchMatches };
		// A request naming no category is the unified listing the brief used to be:
		// it answers with the newest mail, and Marketing is nowhere in it.
		const rows =
			categories.length === 0
				? personalRows
				: categories.flatMap((category) => ROWS[category] ?? []);
		if (params.get("count") === "true") {
			return {
				items: [],
				count: categories.reduce(
					(sum, category) => sum + (TOTALS[category] ?? 0),
					0,
				),
			};
		}
		return { items: rows };
	});

	const router = testRouter(search);
	await router.load();
	const mounted = createDomHarness({ viewportWidth: 1400 });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	return mounted;
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
		await settled(mounted, "Spring sale ends soon");

		const shown = mounted.text();
		for (const subject of ["Spring sale ends soon", "New arrivals"]) {
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
		await settled(mounted, "Spring sale ends soon");

		const marketing = mounted.byText("button", "Marketing");
		assert.match(
			marketing.textContent ?? "",
			/3,942/,
			"the Marketing header stated its page length instead of its category",
		);
		const personal = mounted.byText("button", "Personal");
		assert.match(personal.textContent ?? "", /4,753/);
		assert.ok(
			mounted.text().includes("Show all 3,942"),
			"the section offered no way to the rest of the category",
		);
	});

	it("asks each section for its own category, newest first", async () => {
		const mounted = await mount();
		await settled(mounted, "Spring sale ends soon");

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
		await settled(mounted, "Spring sale ends soon");

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
		const personalAt = shown.indexOf("Design review tomorrow");
		assert.ok(
			personalAt < unclassifiedAt,
			"Unclassified was folded into Personal",
		);
	});

	// Ordering across the seeded windows: the display order is the section order,
	// and within a section it is the order the server answered in. Nothing here
	// re-sorts two truncated lists against each other.
	it("orders sections by display order and rows by the server's answer", async () => {
		const mounted = await mount();
		await settled(mounted, "Spring sale ends soon");

		const shown = mounted.text();
		const at = (text: string) => shown.indexOf(text);
		assert.ok(
			at("Design review tomorrow") < at("Spring sale ends soon"),
			"Personal did not come before Marketing",
		);
		assert.ok(
			at("Spring sale ends soon") < at("New arrivals"),
			"the section reordered the rows the server returned",
		);
		assert.ok(
			at("New arrivals") < at("One last reminder"),
			"the section reordered the rows the server returned",
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
		await settled(mounted, "Spring sale ends soon");

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
