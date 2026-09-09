/**
 * Sharing a calendar by its secret address, and taking it back (#1067).
 *
 * What is asserted is the request that left and what the panel then shows,
 * because the address is only legible for one render: a control that posted
 * nothing and a control that posted and dropped the answer look identical.
 *
 * Held with the real caches from `lib/query-error-handler.ts` and the overlay
 * they escalate to. Which failures this card owns and which take the whole
 * screen is the decision under test: on the harness's quiet default client
 * every status stays inline, so a card that had quietly lost its 403 would
 * still pass.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createElement, Fragment } from "react";
import { CalendarFeedPanel } from "@/components/settings/CalendarFeedPanel";
import { FatalErrorOverlay } from "@/components/ui/FatalErrorOverlay";
import { __resetFatalError } from "@/lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "@/lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "../../test-support/http";

const WORK = "11111111-1111-4111-8111-111111111111";
const FEED_PATH = `/calendars/${WORK}/feed`;
const TOKEN = "9Xq2mB7tK1vHs4dLpZ0rY6wJfN3aC8eQuIoT5gRbVkE";
const NEXT_TOKEN = "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0UvWxYz-_1234A";
const CREATED = Date.parse("2026-05-04T09:12:00Z");

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	__resetFatalError();
});

type Responder = (call: HttpCall) => unknown;

const escalatingClient = (): QueryClient =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

const mount = async (responder: Responder) => {
	http = mockFetch(responder);
	harness = createDomHarness({ queryClient: escalatingClient() });
	harness.renderApp(
		createElement(
			Fragment,
			null,
			createElement(FatalErrorOverlay),
			createElement(CalendarFeedPanel, {
				calendarId: WORK,
				calendarName: "Work",
			}),
		),
	);
	await harness.flush();
	await harness.wait(20);
	await harness.flush();
};

/** The full-screen page took over, instead of this card answering for itself. */
const escalated = (): boolean =>
	harness?.query('[data-testid="fatal-error-overlay"]') != null;

const settle = async () => {
	await harness?.flush();
	await harness?.wait(20);
	await harness?.flush();
};

/**
 * The card's own controls, never the confirmation's. Both spell the action the
 * same way on purpose — the dialog repeats the verb of the button that opened
 * it — so a lookup across the whole panel would answer the confirmation and
 * make "asked before writing" untestable.
 */
const cardButtons = (): HTMLButtonElement[] =>
	(harness?.queryAll<HTMLButtonElement>("button") ?? []).filter(
		(node) => node.closest('[role="dialog"]') === null,
	);

const named = (
	nodes: HTMLButtonElement[],
	label: string,
): HTMLButtonElement | undefined =>
	nodes.find((node) => (node.textContent ?? "").trim() === label);

const button = (label: string): HTMLButtonElement => {
	const found = named(cardButtons(), label);
	if (!found) throw new Error(`no button labelled "${label}"`);
	return found;
};

const hasButton = (label: string): boolean =>
	named(cardButtons(), label) !== undefined;

const confirmButton = (label: string): HTMLButtonElement => {
	const dialog = harness?.query('[role="dialog"]');
	if (!dialog) throw new Error("no confirmation is open");
	const found = named(
		[...dialog.querySelectorAll("button")] as HTMLButtonElement[],
		label,
	);
	if (!found) throw new Error(`the confirmation has no "${label}"`);
	return found;
};

/** A calendar nobody has ever shared: the read is a 404 and owns it. */
const unshared: Responder = (call) => {
	if (call.method === "GET") return httpError(404, "no feed");
	return {};
};

describe("a calendar that is not shared", () => {
	it("offers to create an address instead of reporting a failure", async () => {
		await mount(unshared);
		assert.match(harness?.text() ?? "", /Create subscription address/);
		assert.doesNotMatch(harness?.text() ?? "", /Couldn't read/);
	});

	it("mints the address with one PUT to the calendar's feed", async () => {
		let feed: unknown;
		await mount((call) => {
			if (call.method === "PUT") {
				feed = {
					calendarId: WORK,
					feedToken: TOKEN,
					createdAt: CREATED,
					rotatedAt: 0,
				};
				return feed;
			}
			if (feed) return feed;
			return httpError(404, "no feed");
		});

		harness?.click(button("Create subscription address"));
		await settle();

		const writes = (http?.to(FEED_PATH) ?? []).filter(
			(call) => call.method === "PUT",
		);
		assert.equal(writes.length, 1, "one write minted the address");
	});

	/**
	 * The one render the plaintext exists in. Nothing stores it, so a panel that
	 * dropped it here has handed the reader a calendar they cannot subscribe to
	 * without rotating it again.
	 */
	it("shows the address once, then never again", async () => {
		let feed: unknown;
		await mount((call) => {
			if (call.method === "PUT") {
				feed = {
					calendarId: WORK,
					feedToken: TOKEN,
					createdAt: CREATED,
					rotatedAt: 0,
				};
				return feed;
			}
			if (feed) return feed;
			return httpError(404, "no feed");
		});

		harness?.click(button("Create subscription address"));
		await settle();

		const shown = harness?.text() ?? "";
		assert.match(shown, /shown once and cannot be read back/);
		assert.ok(
			harness
				?.queryAll<HTMLInputElement>("input")
				.some(
					(input) =>
						input.value === `webcal://localhost/feeds/calendar/${TOKEN}.ics`,
				),
			`the webcal address was not on screen: ${harness?.html()}`,
		);

		harness?.click(button("I've saved it"));
		await settle();

		assert.doesNotMatch(harness?.text() ?? "", /shown once/);
		assert.ok(
			!(harness?.html() ?? "").includes(TOKEN),
			"the dismissed address is gone from the document",
		);
		assert.match(harness?.text() ?? "", /Address created/);
	});

	/**
	 * Off the screen is not gone. React Query keeps a mutation's answer for its
	 * whole gcTime, and that answer is the plaintext token — the one thing this
	 * feature promises exists nowhere it can be read back from.
	 */
	it("drops the minted token from the mutation cache when it is dismissed", async () => {
		let feed: unknown;
		await mount((call) => {
			if (call.method === "PUT") {
				feed = {
					calendarId: WORK,
					feedToken: TOKEN,
					createdAt: CREATED,
					rotatedAt: 0,
				};
				return feed;
			}
			if (feed) return feed;
			return httpError(404, "no feed");
		});

		harness?.click(button("Create subscription address"));
		await settle();

		const cached = () =>
			(harness?.queryClient.getMutationCache().getAll() ?? []).filter(
				(mutation) => mutation.state.data !== undefined,
			);
		assert.equal(cached().length, 1, "the answer is held while it is shown");

		harness?.click(button("I've saved it"));
		await settle();

		assert.deepEqual(cached(), [], "no cached answer still holds the token");
		assert.ok(
			!JSON.stringify(
				(harness?.queryClient.getMutationCache().getAll() ?? []).map(
					(mutation) => mutation.state,
				),
			).includes(TOKEN),
			"the token survived in the mutation cache",
		);
	});

	it("states a refused write where the button is", async () => {
		await mount((call) => {
			if (call.method === "PUT") return httpError(404, "Calendar not found");
			return httpError(404, "no feed");
		});

		harness?.click(button("Create subscription address"));
		await settle();

		assert.match(harness?.text() ?? "", /was not changed/);
		assert.match(harness?.text() ?? "", /Calendar not found/);
		assert.ok(!escalated(), "the card owns a refused write, inline");
	});
});

describe("a calendar that is shared", () => {
	const shared =
		(rotatedAt: number): Responder =>
		(call) => {
			if (call.method === "GET")
				return { calendarId: WORK, createdAt: CREATED, rotatedAt };
			return {};
		};

	it("shows no address for the feed it merely knows exists", async () => {
		await mount(shared(0));
		assert.match(harness?.text() ?? "", /Address created/);
		assert.ok(!(harness?.html() ?? "").includes("webcal://"));
	});

	it("asks before replacing the address, and says the old one stops", async () => {
		await mount(shared(0));

		harness?.click(button("Replace address"));
		await settle();

		const asked = harness?.text() ?? "";
		assert.match(asked, /Replace the address for Work\?/);
		assert.match(asked, /stops updating/);
		assert.equal(
			(http?.to(FEED_PATH) ?? []).filter((call) => call.method === "PUT")
				.length,
			0,
			"nothing was written before the confirmation was answered",
		);
	});

	it("replaces the address and hands back the new one, once", async () => {
		let rotated = false;
		await mount((call) => {
			if (call.method === "PUT") {
				rotated = true;
				return {
					calendarId: WORK,
					feedToken: NEXT_TOKEN,
					createdAt: CREATED,
					rotatedAt: CREATED + 1000,
				};
			}
			return {
				calendarId: WORK,
				createdAt: CREATED,
				rotatedAt: rotated ? CREATED + 1000 : 0,
			};
		});

		harness?.click(button("Replace address"));
		await settle();
		harness?.click(confirmButton("Replace address"));
		await settle();

		assert.equal(
			(http?.to(FEED_PATH) ?? []).filter((call) => call.method === "PUT")
				.length,
			1,
		);
		assert.ok(
			harness
				?.queryAll<HTMLInputElement>("input")
				.some((input) => input.value.includes(NEXT_TOKEN)),
			"the replacement address was shown",
		);
		assert.match(harness?.text() ?? "", /last replaced/);
	});

	it("asks before revoking, then leaves the calendar unshared", async () => {
		let revoked = false;
		await mount((call) => {
			if (call.method === "DELETE") {
				revoked = true;
				return {};
			}
			if (revoked) return httpError(404, "no feed");
			return { calendarId: WORK, createdAt: CREATED, rotatedAt: 0 };
		});

		harness?.click(button("Stop sharing"));
		await settle();
		assert.match(harness?.text() ?? "", /Stop sharing Work\?/);

		harness?.click(confirmButton("Stop sharing"));
		await settle();

		assert.equal(
			(http?.to(FEED_PATH) ?? []).filter((call) => call.method === "DELETE")
				.length,
			1,
		);
		assert.ok(hasButton("Create subscription address"));
		assert.doesNotMatch(harness?.text() ?? "", /Address created/);
	});

	/**
	 * A refusal is about the write that was refused, not about the card. Left
	 * standing, it reads as if the replacement that just landed had failed too —
	 * over an address that is on screen and working.
	 */
	it("clears a refused revoke once the next write succeeds", async () => {
		let rotated = false;
		await mount((call) => {
			if (call.method === "DELETE") return httpError(409, "Feed is locked");
			if (call.method === "PUT") {
				rotated = true;
				return {
					calendarId: WORK,
					feedToken: NEXT_TOKEN,
					createdAt: CREATED,
					rotatedAt: CREATED + 1000,
				};
			}
			return {
				calendarId: WORK,
				createdAt: CREATED,
				rotatedAt: rotated ? CREATED + 1000 : 0,
			};
		});

		harness?.click(button("Stop sharing"));
		await settle();
		harness?.click(confirmButton("Stop sharing"));
		await settle();
		assert.match(harness?.text() ?? "", /Feed is locked/);

		harness?.click(button("Replace address"));
		await settle();
		harness?.click(confirmButton("Replace address"));
		await settle();

		assert.doesNotMatch(
			harness?.text() ?? "",
			/was not changed/,
			"the refused revoke outlived the replacement that succeeded",
		);
		assert.doesNotMatch(harness?.text() ?? "", /Feed is locked/);
		assert.ok(
			harness
				?.queryAll<HTMLInputElement>("input")
				.some((input) => input.value.includes(NEXT_TOKEN)),
			"the replacement address was shown",
		);
	});
});

describe("a read the server refuses", () => {
	/**
	 * A 403 is not "not shared". Drawing the create button for it would tell the
	 * reader their calendar is private while it may be subscribed to right now.
	 */
	it("says the state is unknown rather than offering to create one", async () => {
		await mount((call) => {
			if (call.method === "GET") return httpError(403, "not yours");
			return {};
		});

		assert.ok(
			!escalated(),
			"a 403 the card draws inline must not take the whole screen",
		);
		assert.match(harness?.text() ?? "", /Couldn't read whether Work is shared/);
		assert.ok(!hasButton("Create subscription address"));
	});

	/**
	 * The one status this card may not keep to itself. No banner here signs
	 * anyone back in, so a 401 belongs on the page that does.
	 */
	it("escalates a lapsed session instead of drawing it in the card", async () => {
		await mount((call) => {
			if (call.method === "GET") return httpError(401, "signed out");
			return {};
		});

		assert.ok(escalated(), "a 401 on the read stayed inside the card");
	});
});
