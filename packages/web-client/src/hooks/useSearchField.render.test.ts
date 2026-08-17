/**
 * What a typed query survives, and what ends it (#808, #47).
 *
 * The failure this pins: three e2e specs hung their whole timeout on
 * `waitForURL(/q=invoice/)` because the query never reached the address at all.
 * Typing into the field in the window between the router committing the next
 * mailbox and React rendering it put the keystroke and the view change in one
 * render, where the view-change re-seed took the field back to the URL's `q` —
 * empty. The field held nothing, so the mirror had nothing to write, and no
 * later render had any reason to reconsider.
 *
 * Driven through a real router, because the window under test is the router's
 * own: the address commits before the matches swap, and a route the reader has
 * not visited has its component to fetch before it can. Reasoning about that
 * from the outside is not evidence, so the mailbox route here loads on a delay
 * the way an unvisited one does.
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
import { createElement } from "react";
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
const OTHER_MAILBOX_ID = "3d20-sent";

/** What the field committed, so a test can assert what the mirror would write. */
let committed = "";

function SearchField() {
	const { searchInput, committedQuery, setSearchInput } = useSearchField();
	committed = committedQuery;
	return createElement("input", {
		"aria-label": FIELD_LABEL,
		value: searchInput,
		onChange: (event: { target: { value: string } }) =>
			setSearchInput(event.target.value),
	});
}

/**
 * The mail shell over its four lists. Only the mailbox route loads on a delay:
 * it stands for the list the reader has not been to yet, which is the one they
 * navigate to and then type on.
 */
const buildRouter = (mailboxLoadMs: number): AnyRouter => {
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
		history: createMemoryHistory({ initialEntries: ["/mail/brief"] }),
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

describe("a query typed before the reader leaves", () => {
	it("ends with the view it was typed in (#47)", async () => {
		const router = buildRouter(0);
		const { created, field } = await mount(router);

		created.type(field, "invoice");
		await created.wait(DEBOUNCE_SETTLED);
		assert.equal(committed, "invoice");

		openMailbox(router, MAILBOX_ID);
		await created.wait(DEBOUNCE_SETTLED);

		assert.equal(field.value, "");
		assert.equal(committed, "");
	});

	it("does not follow the reader from one mailbox to the next (#47)", async () => {
		const router = buildRouter(0);
		const { created, field } = await mount(router);

		openMailbox(router, MAILBOX_ID);
		await created.wait(10);
		created.type(field, "invoice");
		await created.wait(DEBOUNCE_SETTLED);
		assert.equal(field.value, "invoice");

		openMailbox(router, OTHER_MAILBOX_ID);
		await created.wait(DEBOUNCE_SETTLED);

		assert.equal(field.value, "");
		assert.equal(committed, "");
	});

	it("arrives with the query a destination carries (deep link, saved search)", async () => {
		const router = buildRouter(0);
		const { created, field } = await mount(router);

		created.type(field, "invoice");
		await created.wait(DEBOUNCE_SETTLED);

		void router.navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId: MAILBOX_ID },
			search: { q: "receipts" },
		});
		await created.wait(DEBOUNCE_SETTLED);

		assert.equal(field.value, "receipts");
		assert.equal(committed, "receipts");
	});
});
