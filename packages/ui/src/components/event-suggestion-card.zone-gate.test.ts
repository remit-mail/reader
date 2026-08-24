/**
 * The zone gate — mounted against jsdom rather than `renderToString`, because
 * what has to be proven is that pressing either way out of the card does
 * nothing while the clock is unsettled.
 *
 * Nothing here may read the zone the process happens to run in, so the cases
 * offer clocks the ambient zone is never one of, assert the exact zone that
 * comes back, and move the machine between zones themselves rather than leaving
 * that to whoever runs the suite.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EventSuggestion, ZoneOptions } from "./calendar-types.js";
import {
	EventSuggestionCard,
	settleZone,
	ZONE_UNSETTLED_REASON,
} from "./event-suggestion-card.js";

const LISBON = "Europe/Lisbon";
const AUCKLAND = "Pacific/Auckland";

const suggestion: EventSuggestion = {
	id: "sug_lisbon_call",
	title: "Kickoff call — Lisbon venue",
	start: "2026-06-17T16:00:00+02:00",
	end: "2026-06-17T17:00:00+02:00",
	allDay: false,
	location: "Meet link",
	threadId: "thr_lisbon_call",
	threadSubject: "Kickoff call on Wednesday at 16:00",
	sender: "Rita Sousa",
	senderAddress: "rita@aldeia.example",
	confidence: 0.66,
	ambiguity: "",
	suggestedCalendarId: "c5",
	timeZone: "",
	zoneCertainty: "ambiguous",
};

const zoneless: EventSuggestion = {
	...suggestion,
	zoneOptions: [
		{ timeZone: LISBON, label: "16:00 in Lisbon", note: "17:00 for you." },
		{ timeZone: AUCKLAND, label: "16:00 in Auckland", note: "03:00 for you." },
	],
};

const stated: EventSuggestion = {
	...suggestion,
	timeZone: LISBON,
	zoneCertainty: "explicit",
};

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	dom = new JSDOMCtor(
		"<!doctype html><html><body><div id=root></div></body></html>",
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.MouseEvent = dom.window.MouseEvent;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

after(() => {
	dom.window.close();
});

beforeEach(() => {
	container = dom.window.document.getElementById(
		"root",
	) as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

interface Answers {
	onAdd?: (timeZone: string) => void;
	onReview?: (timeZone: string) => void;
}

function mount(entry: EventSuggestion, answers: Answers = {}) {
	act(() => {
		root.render(
			createElement(EventSuggestionCard, {
				suggestion: entry,
				whenText: "Friday 19 June · 18:40 – 20:25",
				onAdd: answers.onAdd ?? (() => undefined),
				onReview: answers.onReview ?? (() => undefined),
				onDismiss: () => undefined,
				onOpenThread: () => undefined,
			}),
		);
	});
}

function buttonNamed(text: string): HTMLElement {
	const found = Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.includes(text),
	);
	assert.ok(found, `no button reading ${text}`);
	return found as unknown as HTMLElement;
}

function press(target: HTMLElement) {
	act(() => {
		target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
}

/** The paragraph the dimmed Add points at through `aria-describedby`. */
function describedReason(): HTMLElement | null {
	const id = buttonNamed("Add").getAttribute("aria-describedby");
	if (id === null) return null;
	return dom.window.document.getElementById(id);
}

function announced(): string {
	return Array.from(container.querySelectorAll('[role="status"]'))
		.map((node) => node.textContent ?? "")
		.join(" ");
}

describe("the zone gate", () => {
	it("refuses Add until a clock is picked, and says why", () => {
		const added: string[] = [];
		mount(zoneless, { onAdd: (timeZone) => added.push(timeZone) });

		assert.equal(announced(), "");
		assert.equal(describedReason()?.textContent, ZONE_UNSETTLED_REASON);
		assert.ok(describedReason()?.classList.contains("sr-only"));

		press(buttonNamed("Add"));

		assert.deepEqual(added, []);
		assert.match(announced(), /Pick a clock first/);
		assert.equal(describedReason()?.classList.contains("sr-only"), false);
	});

	it("adds on the clock that was picked, never on the ambient one", () => {
		const added: string[] = [];
		mount(zoneless, { onAdd: (timeZone) => added.push(timeZone) });

		press(buttonNamed("16:00 in Auckland"));
		press(buttonNamed("Add"));

		assert.deepEqual(added, [AUCKLAND]);
		assert.notEqual(
			AUCKLAND,
			Intl.DateTimeFormat().resolvedOptions().timeZone,
			"the case only proves anything while the ambient zone is a different one",
		);
	});

	it("settles nothing when the mail already stated the clock", () => {
		const added: string[] = [];
		mount(stated, { onAdd: (timeZone) => added.push(timeZone) });

		press(buttonNamed("Add"));

		assert.deepEqual(added, [""]);
		assert.equal(announced(), "");
	});
});

/**
 * Correcting the reading first is the other way the time leaves the card, and
 * an editor seeded with the unconverted hour books the wrong one just as
 * quietly as Add would.
 */
describe("the same gate on Change first", () => {
	it("refuses Change first until a clock is picked, and says why", () => {
		const reviewed: string[] = [];
		mount(zoneless, { onReview: (timeZone) => reviewed.push(timeZone) });

		const describes =
			buttonNamed("Change first").getAttribute("aria-describedby");
		assert.equal(
			describes,
			buttonNamed("Add").getAttribute("aria-describedby"),
		);
		assert.equal(
			describes === null
				? null
				: dom.window.document.getElementById(describes)?.textContent,
			ZONE_UNSETTLED_REASON,
		);

		press(buttonNamed("Change first"));

		assert.deepEqual(reviewed, []);
		assert.match(announced(), /Pick a clock first/);
	});

	it("opens on the clock that was picked, never on an empty one", () => {
		const reviewed: string[] = [];
		mount(zoneless, { onReview: (timeZone) => reviewed.push(timeZone) });

		press(buttonNamed("16:00 in Auckland"));
		press(buttonNamed("Change first"));

		assert.deepEqual(reviewed, [AUCKLAND]);
	});

	it("stays live when the mail already stated the clock", () => {
		const reviewed: string[] = [];
		mount(stated, { onReview: (timeZone) => reviewed.push(timeZone) });

		press(buttonNamed("Change first"));

		assert.deepEqual(reviewed, [""]);
		assert.equal(
			buttonNamed("Change first").getAttribute("aria-describedby"),
			null,
		);
	});
});

describe("the clocks a suggestion offers", () => {
	it("cannot be an empty list, which would ask with nothing to press", () => {
		// @ts-expect-error
		const none: ZoneOptions = [];
		assert.equal(none.length, 0);
	});

	it("never asks the question without a clock to answer it with", () => {
		mount(zoneless);
		assert.ok(container.textContent?.includes("Which clock is this on?"));
		assert.equal(container.querySelectorAll("[aria-pressed]").length, 2);

		mount(stated);
		assert.equal(
			container.textContent?.includes("Which clock is this on?"),
			false,
		);
		assert.equal(container.querySelectorAll("[aria-pressed]").length, 0);
	});
});

/**
 * The zones the machine might be in. The hour is what noon UTC reads as there,
 * asserted so a Node that ignored the switch could not pass the body silently.
 */
const ZONES = [
	{ name: "UTC", hourAtNoonUtc: 12 },
	{ name: "Europe/Amsterdam", hourAtNoonUtc: 14 },
	{ name: "Pacific/Kiritimati", hourAtNoonUtc: 2 },
];

function inEveryZone(body: () => void): void {
	const before = process.env.TZ;
	try {
		for (const zone of ZONES) {
			process.env.TZ = zone.name;
			assert.equal(
				new Date("2026-06-17T12:00:00Z").getHours(),
				zone.hourAtNoonUtc,
				`the machine never moved to ${zone.name}`,
			);
			body();
		}
	} finally {
		if (before === undefined) delete process.env.TZ;
		else process.env.TZ = before;
	}
}

describe("settleZone", () => {
	it("settles a suggestion that carries no clocks to answer", () => {
		inEveryZone(() => {
			assert.deepEqual(settleZone(stated, ""), { settled: true, timeZone: "" });
		});
	});

	it("holds a suggestion whose clock nobody has picked", () => {
		inEveryZone(() => {
			assert.deepEqual(settleZone(zoneless, ""), {
				settled: false,
				reason: ZONE_UNSETTLED_REASON,
			});
		});
	});

	it("holds a choice that is not one of the clocks offered", () => {
		inEveryZone(() => {
			assert.deepEqual(settleZone(zoneless, "Europe/Amsterdam"), {
				settled: false,
				reason: ZONE_UNSETTLED_REASON,
			});
			assert.deepEqual(settleZone(zoneless, "UTC"), {
				settled: false,
				reason: ZONE_UNSETTLED_REASON,
			});
		});
	});

	it("carries the picked clock through untouched", () => {
		inEveryZone(() => {
			assert.deepEqual(settleZone(zoneless, LISBON), {
				settled: true,
				timeZone: LISBON,
			});
		});
	});
});
