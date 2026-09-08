/**
 * The Spam offer's number comes from the server, one count per junk folder,
 * summed (#313).
 *
 * The offer used to group the search rows the client had loaded, count the ones
 * whose folder is `\Junk`, and state that figure as "N in Spam". The rows are a
 * page, so the number was a count of a window offered as a count of a mailbox:
 * a Spam match older than the page was missing from it, and the figure grew as
 * further pages arrived.
 *
 * The seed here is that page. Every Spam match sits below the window the search
 * request answers with, so the loaded rows hold no junk at all — a client that
 * counts what it holds finds nothing and makes no offer. A client that asks each
 * junk folder finds them, and with two accounts it has to add the two answers
 * up: one number is stated, and each account has a Spam folder of its own.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { ResultFolder } from "@remit/ui";
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
import type { ResultFolderIndex } from "@/lib/result-folder";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount, makeThreadMessage } from "@/test-support/fixtures";
import { type HttpCall, type HttpMock, mockFetch } from "@/test-support/http";
import { DailyBrief } from "./DailyBrief";

const ACCOUNT_A = "acc-a";
const ACCOUNT_B = "acc-b";
const JUNK_A = "mbx-junk-a";
const JUNK_B = "mbx-junk-b";
const INBOX_A = "mbx-inbox-a";

const accounts = [
	makeAccount({ accountId: ACCOUNT_A }),
	makeAccount({ accountId: ACCOUNT_B }),
];

/** What the search says: a word the seeded rows carry. */
const QUERY = "invoice";

/** Matches in Spam, per account. Deliberately no round sum. */
const SPAM_IN_A = 5;
const SPAM_IN_B = 3;

/**
 * The page the search request answers with: matches from the INBOX only. Every
 * Spam match is older than these, so none of them is here — which is exactly
 * the case the old count could not see.
 */
const PAGE: RemitImapThreadMessageResponse[] = Array.from(
	{ length: 4 },
	(_, index) =>
		makeThreadMessage({
			messageId: `inbox-${index}`,
			threadId: `thread-inbox-${index}`,
			accountId: ACCOUNT_A,
			mailboxId: INBOX_A,
			subject: `Invoice ${index} from the office`,
			sentDate: 1_767_225_600_000 - index * 1_000,
		}),
);

/** The `\Junk` appointment is what holds a row out of a search and counts it. */
const FOLDERS: ResultFolderIndex = new Map<string, ResultFolder>([
	[INBOX_A, { role: "inbox" }],
	[JUNK_A, { role: "junk" }],
	[JUNK_B, { role: "junk" }],
]);

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

/** The count requests this render issued, by the folder each one scoped to. */
const spamCountRequests = (): string[] =>
	(http?.calls ?? [])
		.filter(
			(call) => new URL(call.url, "http://localhost").pathname === "/threads",
		)
		.filter((call) => paramsOf(call).get("count") === "true")
		.map((call) => paramsOf(call).get("mailboxId") ?? "")
		.filter((mailboxId) => mailboxId === JUNK_A || mailboxId === JUNK_B);

const context = (): MailContextValue => ({
	accounts,
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: FOLDERS,
	searchQuery: QUERY,
	searchInput: QUERY,
	searchViewKey: "brief",
	onSearchChange: () => undefined,
	onSearchClear: () => undefined,
	onSearchClearQuery: () => undefined,
	intelligenceOpen: false,
	onToggleIntelligence: () => undefined,
	onRaiseIntelligence: () => undefined,
});

const brief = (): ReactNode =>
	createElement(MailFreshnessProvider, {
		accountIds: [ACCOUNT_A, ACCOUNT_B],
		// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
		children: createElement(
			MailContext.Provider,
			{ value: context() },
			createElement(DailyBrief, {
				accounts,
				onDeleteMessages: () => undefined,
			}),
		),
	});

const testRouter = (): AnyRouter => {
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
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		component: Outlet,
	});
	const briefRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/brief",
		component: brief,
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

/** What each junk folder answers `count: true` with; `undefined` counts nothing. */
type JunkCounts = Record<string, number | undefined>;

const mount = async (junk: JunkCounts): Promise<DomHarness> => {
	http = mockFetch((call) => {
		const url = new URL(call.url, "http://localhost");
		if (url.pathname.endsWith("/config")) return { accounts };
		if (url.pathname !== "/threads") return { items: [] };
		const params = url.searchParams;
		if (params.get("count") === "true") {
			const mailboxId = params.get("mailboxId");
			if (mailboxId === null) return { count: 0 };
			const count = junk[mailboxId];
			// A folder the server declines to count answers with no `count` at all,
			// never with a zero — the distinction the offer has to keep.
			return count === undefined ? {} : { count };
		}
		// The search answers with the page above. Its Spam matches are older than
		// every row in it, so no junk row reaches the client.
		if (params.get("query")) return { items: PAGE };
		return { items: [] };
	});

	const router = testRouter();
	await router.load();
	const dom = createDomHarness({ viewportWidth: 1400 });
	harness = dom;
	dom.renderApp(createElement(RouterProvider, { router }));
	await dom.flush();
	await dom.wait(20);
	await dom.flush();
	await dom.waitFor(
		() => dom.text().includes("from Spam") || dom.text().includes("Invoice 0"),
		"the brief to render its matches",
	);
	return dom;
};

describe("the Spam offer's count comes from the server (#313)", () => {
	// The regression. Every Spam match sits below the page the search returned,
	// so a client counting its own rows offers nothing at all.
	it("counts Spam matches the loaded page never held", async () => {
		const mounted = await mount({ [JUNK_A]: SPAM_IN_A, [JUNK_B]: 0 });
		await mounted.waitFor(
			() => mounted.text().includes("from Spam"),
			"the Spam offer to state a count",
		);

		assert.ok(
			PAGE.every((row) => row.mailboxId !== JUNK_A && row.mailboxId !== JUNK_B),
			"the page under test stopped being junk-free",
		);
		assert.match(
			mounted.text(),
			new RegExp(`${SPAM_IN_A}\\s*results from Spam`),
		);
		assert.match(mounted.text(), /Go to Spam/);
	});

	it("sums one count per junk folder, so several accounts read as one number", async () => {
		const mounted = await mount({ [JUNK_A]: SPAM_IN_A, [JUNK_B]: SPAM_IN_B });
		await mounted.waitFor(
			() => mounted.text().includes("from Spam"),
			"the Spam offer to state a count",
		);

		assert.deepEqual(
			[...new Set(spamCountRequests())].sort(),
			[JUNK_A, JUNK_B].sort(),
			"the offer did not ask every junk folder for its own count",
		);
		assert.match(
			mounted.text(),
			new RegExp(`${SPAM_IN_A + SPAM_IN_B}\\s*results from Spam`),
			"the offer stated one account's share instead of the total",
		);
	});

	it("makes no offer when every junk folder counted zero", async () => {
		const mounted = await mount({ [JUNK_A]: 0, [JUNK_B]: 0 });
		await mounted.waitFor(
			() => mounted.text().includes("Invoice 0"),
			"the brief to render its matches",
		);

		assert.ok(
			!mounted.text().includes("from Spam"),
			"the offer stood over a search that reaches no spam",
		);
	});

	// Summing only the folders that answered would state a figure that is exact
	// in form and short in fact, and nothing on screen tells the two apart.
	it("states no number when a junk folder went uncounted", async () => {
		const mounted = await mount({
			[JUNK_A]: SPAM_IN_A,
			[JUNK_B]: undefined,
		});
		await mounted.waitFor(
			() => mounted.text().includes("from Spam"),
			"the Spam offer to stand",
		);

		assert.match(mounted.text(), /Results from Spam/);
		assert.doesNotMatch(
			mounted.text(),
			new RegExp(`${SPAM_IN_A}\\s*results from Spam`),
		);
	});
});
