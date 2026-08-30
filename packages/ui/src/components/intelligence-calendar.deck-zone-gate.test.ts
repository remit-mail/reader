/**
 * The zone gate on the deck's swipe. The buttons inside the card are guarded by
 * `event-suggestion-card.zone-gate.test.ts`; the gesture is a second way out of
 * the same card, and it bypassed the card's own refusal entirely — a swipe right
 * booked a zoneless reading on an empty zone.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ZONE_UNSETTLED_REASON } from "./event-suggestion-card.js";
import {
	IntelligenceCalendar,
	type IntelligenceCalendarActions,
} from "./intelligence-calendar.js";
import { flightConfirmation } from "./intelligence-calendar-fixtures.js";

const LISBON = "Europe/Lisbon";
const COMMIT_DISTANCE = 96;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

interface Added {
	id: string;
	timeZone: string;
}

function mount(added: Added[]) {
	const actions: IntelligenceCalendarActions = {
		onAddInvite: () => undefined,
		onTentativeInvite: () => undefined,
		onDeclineInvite: () => undefined,
		onReopenInvite: () => undefined,
		onOfferOtherTimes: () => undefined,
		onRemoveInvite: () => undefined,
		onOpenNewerInvite: () => undefined,
		onToggleSlot: () => undefined,
		onAddSuggestion: (id, timeZone) => added.push({ id, timeZone }),
		onReviewSuggestion: () => undefined,
		onDismissSuggestion: () => undefined,
		onOpenThread: () => undefined,
		onSelectEvent: () => undefined,
	};
	act(() => {
		root.render(
			createElement(IntelligenceCalendar, {
				data: flightConfirmation,
				actions,
			}),
		);
	});
}

/** The element the deck attaches the gesture to. */
function deckSurface(): Element {
	const surface = container.querySelector(".touch-pan-y");
	assert.ok(surface, "the deck did not mount its gesture surface");
	return surface;
}

function pointer(target: Element, type: string, clientX: number) {
	act(() => {
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				pointerType: "touch",
				pointerId: 1,
				clientX,
				clientY: 40,
			}),
		);
	});
}

function swipeRight() {
	const surface = deckSurface();
	pointer(surface, "pointerdown", 0);
	pointer(surface, "pointermove", COMMIT_DISTANCE + 40);
	pointer(surface, "pointerup", COMMIT_DISTANCE + 40);
}

function buttonNamed(text: string): Element {
	const found = Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.includes(text),
	);
	assert.ok(found, `no button reading ${text}`);
	return found;
}

function press(target: Element) {
	act(() => {
		target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

describe("swiping a suggestion right in the calendar tab", () => {
	it("books nothing while the mail never said which clock", () => {
		const added: Added[] = [];
		mount(added);

		swipeRight();

		assert.deepEqual(added, []);
	});

	it("says why the swipe will not commit", () => {
		mount([]);
		const surface = deckSurface();

		pointer(surface, "pointerdown", 0);
		pointer(surface, "pointermove", COMMIT_DISTANCE + 40);

		assert.ok(container.textContent?.includes(ZONE_UNSETTLED_REASON));

		pointer(surface, "pointerup", COMMIT_DISTANCE + 40);
	});

	it("books on the clock that was picked once one is", () => {
		const added: Added[] = [];
		mount(added);

		press(buttonNamed("20:25 in Lisbon"));
		swipeRight();

		assert.deepEqual(added, [{ id: "sug_flight", timeZone: LISBON }]);
	});
});
