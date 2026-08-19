/**
 * A query typed as the reader arrives on a list (#808).
 *
 * Three e2e specs hung their whole timeout on `waitForURL(/q=invoice/)` because
 * the query never reached the address at all. Typing in the window between the
 * router committing the next mailbox and React rendering it put the keystroke
 * and the view change in one render, where the view-change re-seed took the
 * field back to the destination's `q` — empty. The field held nothing, so the
 * mirror had nothing to write, and no later render had any reason to reconsider.
 *
 * Driven through a real router, because the window under test is the router's
 * own: the address commits before the matches swap, and a route the reader has
 * not visited yet has its component to fetch before it can. Reasoning about
 * that from the outside is not evidence, so the mailbox route here loads on a
 * delay the way an unvisited one does.
 *
 * The other half is here too: a query ending with the view it was typed in
 * (#47). That window is the same one, read the other way round — the address
 * has moved and the matches have not — and the field must re-seed from the
 * address rather than from the query the outgoing list still answers with.
 * `lib/search-view.test.ts` drives the rules themselves.
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
import { createElement, useState } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { useSearchField } from "./useSearchField";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const FIELD_LABEL = "Search mail";
const MAILBOX_ID = "9f1c-abc";
const RENDER_AGAIN = "render again";

/** What the field committed, so a test can assert what the mirror would write. */
let committed = "";

/**
 * The field, plus a way to make it render on demand. Typing renders it; a
 * navigation on its own does not, because this harness does not propagate a
 * router store change into React the way the running app does — so a test that
 * only navigates is asking nothing.
 */
function SearchField() {
	const { searchInput, committedQuery, setSearchInput } = useSearchField();
	const [renders, setRenders] = useState(0);
	committed = committedQuery;
	return createElement(
		"div",
		null,
		createElement("input", {
			"aria-label": FIELD_LABEL,
			value: searchInput,
			onChange: (event: { target: { value: string } }) =>
				setSearchInput(event.target.value),
		}),
		createElement(
			"button",
			{
				type: "button",
				"aria-label": RENDER_AGAIN,
				onClick: () => setRenders(renders + 1),
			},
			String(renders),
		),
	);
}

/**
 * The mail shell over its four lists. Only the mailbox route loads on a delay:
 * it stands for the list the reader has not been to yet, which is the one they
 * navigate to and then type on.
 */
const buildRouter = (
	mailboxLoadMs: number,
	href = "/mail/brief",
): AnyRouter => {
	const passthrough = (search: Record<string, unknown>) => search;
	const rootRoute = createRootRoute({ component: Outlet });
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: passthrough,
		component: () => createElement(SearchField, null),
	});
	const briefRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/brief",
		validateSearch: passthrough,
		component: () => null,
	});
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		validateSearch: passthrough,
		loader: async () => {
			await new Promise((resolve) => setTimeout(resolve, mailboxLoadMs));
			return null;
		},
		component: () => null,
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([briefRoute, mailboxRoute]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

const mount = async (
	router: AnyRouter,
): Promise<{ created: DomHarness; field: HTMLInputElement }> => {
	const created = createDomHarness();
	harness = created;
	committed = "";
	await router.load();
	created.renderApp(createElement(RouterProvider, { router }));
	await created.flush();
	return {
		created,
		field: created.byLabel(FIELD_LABEL) as HTMLInputElement,
	};
};

/** Long enough for the 200 ms debounce to settle on whatever the field holds. */
const DEBOUNCE_SETTLED = 400;

const openMailbox = (router: AnyRouter, mailboxId: string): void => {
	void router.navigate({ to: "/mail/$mailboxId", params: { mailboxId } });
};

describe("a query the reader left behind on the previous list (#47)", () => {
	// The sidebar link drops `q`, so the destination's address carries none. The
	// field is re-seeded from that address and the mirror then has nothing to
	// write, which is what keeps the query out of the next mailbox's URL.
	for (const mailboxLoadMs of [0, 300]) {
		it(`does not follow them into the next list (list ready in ${mailboxLoadMs}ms)`, async () => {
			const router = buildRouter(mailboxLoadMs, "/mail/brief?q=invoice");
			const { created, field } = await mount(router);
			assert.equal(field.value, "invoice");

			openMailbox(router, MAILBOX_ID);
			await created.wait(10);
			// The render inside the window the address has moved in and the
			// matches have not: the outgoing list still answers `q=invoice`, and
			// re-seeding from it hands the query to the mailbox being opened.
			created.click(created.byLabel(RENDER_AGAIN));
			await created.wait(mailboxLoadMs + DEBOUNCE_SETTLED);
			created.click(created.byLabel(RENDER_AGAIN));
			await created.wait(DEBOUNCE_SETTLED);

			assert.equal(field.value, "");
			assert.equal(committed, "");
		});
	}

	it("arrives with a query the destination carries", async () => {
		// The scope chip sends the reader to the brief to search everything, so
		// the query travels in the address it navigates to and is kept.
		const router = buildRouter(0, "/mail/9f1c-abc?q=invoice");
		const { created, field } = await mount(router);

		void router.navigate({ to: "/mail/brief", search: { q: "invoice" } });
		await created.wait(10);
		created.click(created.byLabel(RENDER_AGAIN));
		await created.wait(DEBOUNCE_SETTLED);

		assert.equal(field.value, "invoice");
		assert.equal(committed, "invoice");
	});
});

describe("a query typed as the reader arrives on a mailbox", () => {
	// The address is already the mailbox — that is what `waitForURL` returns on
	// — so the text was typed on the mailbox and is the mailbox's query.
	for (const mailboxLoadMs of [0, 300]) {
		it(`survives the view change it followed (list ready in ${mailboxLoadMs}ms)`, async () => {
			const router = buildRouter(mailboxLoadMs);
			const { created, field } = await mount(router);

			openMailbox(router, MAILBOX_ID);
			await created.wait(10);
			assert.equal(
				router.state.location.pathname,
				`/mail/${MAILBOX_ID}`,
				"the address moves before the list is on screen",
			);

			created.type(field, "invoice");
			await created.wait(mailboxLoadMs + DEBOUNCE_SETTLED);

			assert.equal(field.value, "invoice");
			assert.equal(committed, "invoice");
		});
	}
});
