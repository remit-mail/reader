// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
import assert from "node:assert";
import { afterEach, describe, mock, test } from "node:test";
import {
	type AnyRoute,
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, createElement } from "react";
import {
	REDIRECT_STALL_MESSAGE,
	REDIRECT_STALL_MS,
} from "@/hooks/useRedirectEnded";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { mapOauthError, Route } from "./accounts.tsx";

describe("mapOauthError", () => {
	test("access_denied returns cancellation message", () => {
		assert.strictEqual(
			mapOauthError("access_denied"),
			"You cancelled the sign-in.",
		);
	});

	test("ACCESS_DENIED is case-insensitive", () => {
		assert.strictEqual(
			mapOauthError("ACCESS_DENIED"),
			"You cancelled the sign-in.",
		);
	});

	test("consent_required returns admin consent message", () => {
		const result = mapOauthError("consent_required");
		assert.ok(
			result.toLowerCase().includes("admin"),
			`Expected admin hint, got: ${result}`,
		);
	});

	test("admin_consent_required returns admin consent message", () => {
		const result = mapOauthError("admin_consent_required");
		assert.ok(
			result.toLowerCase().includes("admin"),
			`Expected admin hint, got: ${result}`,
		);
	});

	test("interaction_required returns admin consent message", () => {
		const result = mapOauthError("interaction_required");
		assert.ok(
			result.toLowerCase().includes("admin"),
			`Expected admin hint, got: ${result}`,
		);
	});

	test("imap_disabled returns IMAP hint", () => {
		const result = mapOauthError("imap_disabled");
		assert.ok(
			result.toLowerCase().includes("imap"),
			`Expected IMAP hint, got: ${result}`,
		);
	});

	test("unknown code returns generic fallback with the code", () => {
		const result = mapOauthError("some_random_error");
		assert.ok(
			result.includes("some_random_error"),
			`Expected code in message, got: ${result}`,
		);
	});

	test("empty string returns generic fallback", () => {
		const result = mapOauthError("");
		assert.ok(typeof result === "string" && result.length > 0);
	});
});

/**
 * The Reconnect button and the redirect it starts (#646, PR #955).
 *
 * The busy state rides a latch, not the mutation settling, because
 * `window.location.assign` returns with the page still here. The latch needs an
 * end as well as a start: Back out of Microsoft's consent screen restores this
 * page with the account still asking to be re-authenticated, so nothing else
 * clears it and the button reads "Redirecting…" for good.
 */

/** Same-origin and hash-only, so jsdom performs it rather than logging it. */
const CONSENT_URL = "http://localhost/#microsoft-consent";

const REAUTH_ACCOUNT = {
	accountId: "acc-1",
	email: "matthijs@ischen.nl",
	displayName: "Matthijs",
	authType: "oauthMicrosoft",
	connectionState: "reauth_required",
};

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

const settle = async (dom: DomHarness): Promise<void> => {
	for (let round = 0; round < 4; round += 1) {
		await dom.flush();
		await dom.wait(20);
	}
};

/**
 * jsdom reports "prerender" unless it is pretending to be visual, and the
 * shared environment deliberately does not — so a spec that means "the window
 * is being looked at" has to say so.
 */
const setVisibility = (state: "hidden" | "visible"): void => {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => state,
	});
};

/** jsdom has no `PageTransitionEvent`; `persisted` is what the hook reads. */
const pageShow = (persisted: boolean): Event => {
	const event = new Event("pageshow");
	Object.defineProperty(event, "persisted", { value: persisted });
	return event;
};

/** The real route, mounted the way the generated tree mounts it. */
const mountAccounts = async (): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/oauth/microsoft/start")) {
			return { authorizationUrl: CONSENT_URL };
		}
		if (call.path.endsWith("/config")) {
			return { accounts: [REAUTH_ACCOUNT], mailboxes: [] };
		}
		return {};
	});

	const rootRoute = createRootRoute({ component: Outlet });
	const accountsRoute = (
		Route as unknown as { update: (options: unknown) => AnyRoute }
	).update({
		id: "/settings/accounts",
		path: "/settings/accounts",
		getParentRoute: () => rootRoute,
	});
	const routeTree = rootRoute.addChildren([
		accountsRoute,
	]) as unknown as AnyRoute;
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/settings/accounts"] }),
	}) as unknown as AnyRouter;
	await router.load();

	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await settle(mounted);
	return mounted;
};

/** `settle`, for a spec that has taken the clock over: tick instead of wait. */
const settleOnMockedClock = async (dom: DomHarness): Promise<void> => {
	for (let round = 0; round < 4; round += 1) {
		await dom.flush();
		await act(async () => {
			mock.timers.tick(20);
		});
	}
};

const startReconnect = async (dom: DomHarness): Promise<void> => {
	dom.click(dom.byText("button", "Reconnect"));
	await settle(dom);
};

describe("the Reconnect button and the redirect it starts", () => {
	afterEach(() => {
		mock.timers.reset();
		harness?.close();
		harness = undefined;
		http?.restore();
		http = undefined;
		Reflect.deleteProperty(document, "visibilityState");
	});

	test("goes busy and stays busy while the redirect is in flight", async () => {
		const dom = await mountAccounts();
		await startReconnect(dom);

		assert.match(dom.text(), /Redirecting…/);

		// A look at a window that never left is not the redirect ending.
		setVisibility("visible");
		dom.dispatch(dom.document, new Event("visibilitychange"));
		dom.dispatch(dom.window, pageShow(false));
		await settle(dom);

		assert.match(dom.text(), /Redirecting…/);
	});

	test("states the failure when the redirect never leaves the page", async () => {
		const dom = await mountAccounts();
		// The stall timer is armed inside the click, so the clock has to be the
		// mocked one before the button is pressed.
		setVisibility("visible");
		mock.timers.enable({ apis: ["setTimeout"] });
		dom.click(dom.byText("button", "Reconnect"));
		await settleOnMockedClock(dom);

		assert.match(dom.text(), /Redirecting…/);

		// No `pagehide` and no restore: the window stays where it is, being
		// looked at, past the point where a redirect that is going to happen has
		// happened.
		await act(async () => {
			mock.timers.tick(REDIRECT_STALL_MS);
		});
		await dom.flush();

		assert.doesNotMatch(
			dom.text(),
			/Redirecting…/,
			"an `assign` that never navigated held the button busy for good",
		);
		assert.ok(dom.byText("button", "Reconnect"));
		assert.ok(
			dom.text().includes(REDIRECT_STALL_MESSAGE),
			"the button went live again without saying what failed",
		);
	});

	test("re-arms when the restored page still needs re-authenticating", async () => {
		const dom = await mountAccounts();
		await startReconnect(dom);

		dom.dispatch(dom.window, pageShow(true));
		await settle(dom);

		assert.doesNotMatch(
			dom.text(),
			/Redirecting…/,
			"Back out of the consent screen left the button busy for good",
		);
		assert.ok(dom.byText("button", "Reconnect"));
	});
});
