/**
 * The chrome the list header hands its body is one object, and the body is a
 * virtualized list that re-renders every row when that object changes (#506).
 *
 * What is typed, where the caret is, which suggestion is highlighted and what
 * the query converts to belong to the field and the wizard, not to the list.
 * None of it changes anything the header shows, so the body must be handed back
 * the object it already has.
 *
 * Driven through the real field and real keystrokes, in the real header, so
 * every assertion is about the object the body receives rather than the shape of
 * any one memo that fed it — `use-suggest-list.test.ts` is what pins the
 * combobox props the field itself reads.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement, Profiler, useCallback, useMemo, useState } from "react";
import {
	type ListHeaderChrome,
	useListHeaderChrome,
} from "@/lib/list-header-chrome";
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { MailListHeader } from "./MailListHeader";

const MAILBOX_ID = "11111111-1111-4111-8111-111111111111";
/** Tablet: the tier whose list header owns the field, rather than the top bar. */
const TABLET_WIDTH = 900;
/** A bare word, so the offer is token names and needs no lookup. */
const TYPED = "fro";
/** Still a bare word, so the query converts to the same clause and copy. */
const TYPED_NEXT = `${TYPED}g`;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let chromes: ListHeaderChrome[] = [];
/** Commits React made in the header's subtree, so "it held" cannot mean "nothing ran". */
let commits = 0;
/** Which body the mounted view has: its own rows, or the read-only results panel. */
let resultsInBody = true;
/** The address the view mounts on; a `q` on it is a query already committed. */
let initialPath = `/mail/${MAILBOX_ID}`;
/**
 * The query the shell has committed, as the /mail shell would hand it down: the
 * field is mirrored to the URL on a debounce, so a view mounted on an address
 * carrying `q` reads a query the next keystroke does not move. Unset, the typed
 * text answers for both, which is the mid-debounce case the other tests are in.
 */
let committedQuery: string | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	chromes = [];
	commits = 0;
	resultsInBody = true;
	initialPath = `/mail/${MAILBOX_ID}`;
	committedQuery = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

/** Stands in for the list: it takes the chrome and renders the field slot. */
function ChromeProbe() {
	const chrome = useListHeaderChrome();
	chromes.push(chrome);
	return createElement("div", null, chrome.searchField);
}

function Header() {
	const [query, setQuery] = useState(TYPED);
	const clear = useCallback(() => setQuery(""), []);
	const context = useMemo<MailContextValue>(
		() => ({
			accounts: [],
			mailboxNameIndex: new Map(),
			accountNameIndex: new Map(),
			resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
			searchQuery: committedQuery ?? query,
			searchInput: query,
			searchViewKey: "list",
			onSearchChange: setQuery,
			onSearchClear: clear,
			onSearchClearQuery: clear,
			intelligenceOpen: false,
			onToggleIntelligence: () => undefined,
			onRaiseIntelligence: () => undefined,
		}),
		[query, clear],
	);
	return createElement(
		MailContext.Provider,
		{ value: context },
		createElement(
			Profiler,
			{
				id: "list-header",
				onRender: () => {
					commits += 1;
				},
			},
			createElement(MailListHeader, {
				title: "Inbox",
				unreadCount: null,
				// Set, the body renders the committed search itself and the read-only
				// results panel stays out of the chrome; unset, the panel rides in the
				// chrome, which is the other thing a keystroke must not churn.
				searchResultsInBody: resultsInBody,
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children: createElement(ChromeProbe),
			}),
		),
	);
}

const testRouter = (): AnyRouter => {
	const rootRoute = createRootRoute({ component: Outlet });
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		component: Header,
	});
	return createRouter({
		routeTree: rootRoute.addChildren([mailRoute.addChildren([mailboxRoute])]),
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	}) as unknown as AnyRouter;
};

/** Mount the header with a query typed and the field holding focus. */
const mount = async (
	options: { resultsPanelInChrome?: boolean; committedQuery?: string } = {},
): Promise<{
	mounted: DomHarness;
	field: HTMLInputElement;
}> => {
	resultsInBody = options.resultsPanelInChrome !== true;
	committedQuery = options.committedQuery;
	initialPath = committedQuery
		? `/mail/${MAILBOX_ID}?q=${committedQuery}`
		: `/mail/${MAILBOX_ID}`;
	http = mockFetch(() => ({ items: [] }));
	const router = testRouter();
	await router.load();
	const mounted = createDomHarness({ viewportWidth: TABLET_WIDTH });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.waitFor(
		() => mounted.query('[aria-label="Search mail"]') !== null,
		"the header's search field",
	);
	const field = mounted.query<HTMLInputElement>('[aria-label="Search mail"]');
	assert.ok(field, "the header rendered no search field");
	mounted.dispatch(field, new Event("focusin", { bubbles: true }));
	await mounted.waitFor(
		() => field.getAttribute("aria-expanded") === "true",
		"the suggestion list to open",
	);
	return { mounted, field };
};

const press = (mounted: DomHarness, field: Element, key: string) => {
	mounted.dispatch(
		field,
		new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
	);
};

describe("the chrome the list header hands its body (#506)", () => {
	it("is the same object across a keystroke that only moves the field's highlight", async () => {
		const { mounted, field } = await mount();
		const before = chromes.at(-1);
		assert.ok(before, "the body was never handed a chrome");
		const handedBefore = chromes.length;
		const commitsBefore = commits;

		press(mounted, field, "ArrowDown");
		await mounted.flush();

		assert.ok(
			commits > commitsBefore,
			"the keystroke committed no render at all, so the memo was never put to the test",
		);
		assert.ok(
			field.getAttribute("aria-activedescendant"),
			"the keystroke did not move the highlight, so nothing was put to the test",
		);
		assert.equal(
			chromes.length,
			handedBefore,
			"a highlight move in the field re-rendered the list below it",
		);
		assert.equal(
			chromes.at(-1),
			before,
			"a highlight move in the field pushed a new chrome at the list below it",
		);
	});

	// The symptom #506 was filed on: a mailbox on tablet, its query already in the
	// URL, its own rows in the body — and a character typed into the field
	// repainting all of them. Everything a keystroke moves here (the parse, the
	// conversion the wizard opens on, the copy the make-this-a-filter row shows)
	// is derived from the text, so the chrome holds only if none of it rides on it.
	//
	// The typed text lives above the header, so the list is re-rendered either
	// way — what it must be handed is the chrome it already has, which is what
	// keeps its own rows off the render path.
	it("is the same object across a character typed over a committed query", async () => {
		const { mounted, field } = await mount({ committedQuery: TYPED });
		const before = chromes.at(-1);
		assert.ok(before, "the body was never handed a chrome");
		const handedBefore = chromes.length;
		const commitsBefore = commits;

		mounted.type(field, TYPED_NEXT);
		await mounted.flush();

		assert.equal(
			field.value,
			TYPED_NEXT,
			"the character never reached the field",
		);
		assert.ok(
			commits > commitsBefore,
			"the keystroke committed no render at all, so the memo was never put to the test",
		);
		assert.ok(
			chromes.length > handedBefore,
			"the list was never re-rendered, so it was never handed a second chrome to compare",
		);
		// Identity, not `assert.equal`: a failure there renders a diff of two
		// chromes full of React elements, and that is what runs the reporter out of
		// memory rather than reporting the bug.
		assert.ok(
			chromes.at(-1) === before,
			"a character typed over a committed query pushed a new chrome at the list below it",
		);
	});

	it("is the same object for a view whose results panel rides in the chrome", async () => {
		const { mounted, field } = await mount({ resultsPanelInChrome: true });
		const before = chromes.at(-1);
		assert.ok(before?.searchResults, "the panel never reached the chrome");
		const handedBefore = chromes.length;
		const commitsBefore = commits;

		press(mounted, field, "ArrowDown");
		await mounted.flush();

		assert.ok(
			commits > commitsBefore,
			"the keystroke committed no render at all, so the memo was never put to the test",
		);
		assert.equal(
			chromes.length,
			handedBefore,
			"a highlight move in the field re-rendered the list below it",
		);
		assert.equal(chromes.at(-1), before);
	});

	it("is the same object across the field taking and losing focus", async () => {
		const { mounted, field } = await mount();
		const before = chromes.at(-1);
		const handedBefore = chromes.length;
		const commitsBefore = commits;

		mounted.dispatch(field, new Event("focusout", { bubbles: true }));
		await mounted.flush();
		mounted.dispatch(field, new Event("focusin", { bubbles: true }));
		await mounted.waitFor(
			() => field.getAttribute("aria-expanded") === "true",
			"the suggestion list to open again",
		);

		assert.ok(
			commits > commitsBefore,
			"focus moved nothing, so the memo was never put to the test",
		);
		assert.equal(
			chromes.length,
			handedBefore,
			"focusing the field re-rendered the list below it",
		);
		assert.equal(chromes.at(-1), before);
	});

	// The key handler is stable now, so it has to read the highlight the field
	// is showing rather than the one it was bound with.
	it("still takes the highlighted suggestion on Enter", async () => {
		const { mounted, field } = await mount();

		press(mounted, field, "ArrowDown");
		await mounted.flush();
		press(mounted, field, "Enter");
		await mounted.flush();

		assert.notEqual(field.value, TYPED, "Enter left the query as it was typed");
		assert.match(field.value, /^from:/);
	});
});
