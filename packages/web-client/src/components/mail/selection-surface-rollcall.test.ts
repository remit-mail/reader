/**
 * The roll-call no run can take: which surfaces exist.
 *
 * Everything a selection surface *does* — a verb opening the wizard, the review
 * naming what it covers, a run reaching the mail server — is driven end to end
 * by `packages/e2e`. What no run observes is a surface that was never wired: a
 * fourth pane growing its own direct handler while every other route was moved,
 * or a fourth list rendering the make-filter row with no wizard behind it. Both
 * are invisible in review, indistinguishable from correct, and only found by
 * someone selecting 3,412 messages and pressing a key.
 *
 * So this reads the source, and reads it only for the census: who raises a bar,
 * who declares a keyboard verb over a selection, who renders the make-filter
 * row. It asserts nothing about how any of them behaves.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string =>
	readFileSync(resolve(here, file), "utf8");

const sourceFiles = (): string[] =>
	readdirSync(here).filter((file) => file.endsWith(".tsx"));

const BAR_VERB_PROPS = [
	"onDelete",
	"onMove",
	"onOrganize",
	"onJunk",
	"onMarkRead",
] as const;

const bracedFrom = (source: string, open: number): string => {
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) return source.slice(open, i + 1);
		}
	}
	return source.slice(open);
};

const namedCallbackBody = (source: string, name: string): string => {
	const at = source.indexOf(`const ${name} = useCallback(`);
	if (at === -1) return "";
	const open = source.indexOf("{", at);
	return open === -1 ? "" : bracedFrom(source, open);
};

const barMarkup = (source: string): string => {
	const start = source.indexOf("<SelectionTopBar");
	if (start === -1) return "";
	let depth = 0;
	for (let i = start; i < source.length; i++) {
		if (source[i] === "<" && /[A-Za-z]/.test(source[i + 1] ?? "")) depth++;
		else if (source.startsWith("/>", i)) {
			depth--;
			if (depth === 0) return source.slice(start, i + 2);
			i++;
		} else if (source.startsWith("</", i)) depth--;
	}
	return "";
};

const declaredHandlers = (source: string): string[] => {
	const at = source.indexOf("handlers: {");
	if (at === -1) return [];
	return Array.from(
		bracedFrom(source, source.indexOf("{", at)).matchAll(/\n\t{3}(\w+): /g),
		(match) => match[1],
	);
};

const paneVerbBody = (source: string, handler: string): string => {
	const at = source.search(new RegExp(`\\n\\t{3}${handler}: `));
	if (at === -1) return "";
	const value =
		source.slice(at).match(new RegExp(`${handler}: (.*)`))?.[1] ?? "";
	const body = value.startsWith("(")
		? bracedFrom(source, source.indexOf("{", at))
		: namedCallbackBody(source, value.replace(/[,\s].*$/, ""));
	const helpers = Array.from(body.matchAll(/\b(\w+MessageIds)\(\)/g), (match) =>
		namedCallbackBody(source, match[1]),
	);
	return [body, ...helpers].join("\n");
};

describe("the surfaces that raise a selection bar", () => {
	const surfaces = (): string[] =>
		sourceFiles()
			.filter((file) => /<SelectionTopBar/.test(read(file)))
			.sort();

	it("are these three and no others", () => {
		assert.deepEqual(surfaces(), [
			"DailyBrief.tsx",
			"MessageList.tsx",
			"ThreadListInteraction.tsx",
		]);
	});

	for (const file of ["DailyBrief.tsx", "MessageList.tsx"]) {
		it(`${file} drops none of the five verbs from the bar it raises`, () => {
			const bar = barMarkup(read(file));
			assert.notEqual(bar, "", `${file} renders a SelectionTopBar`);
			for (const prop of BAR_VERB_PROPS) {
				assert.match(bar, new RegExp(`${prop}=`), `${file} offers ${prop}`);
			}
		});
	}
});

// A pane that runs a verb over `selectedIds` without offering the list the
// press first is the hole no run can see: the pane's fallback and the list's
// claim are indistinguishable from outside until a selection outlives the
// list's commands. That the list claims the press is rendered in
// `./ThreadListInteraction.test.ts`.
describe("the panes that answer a keyboard verb over a selection", () => {
	const PANES = ["MailboxPane.tsx", "BriefPane.tsx", "FlaggedPane.tsx"];
	const PANE_VERB_ROUTE: Record<string, string> = {
		delete: "delete",
		toggleRead: "markRead",
		markJunk: "junk",
	};

	const routed = (): string[] =>
		PANES.flatMap((file) =>
			declaredHandlers(read(file))
				.filter((handler) => handler in PANE_VERB_ROUTE)
				.map((handler) => `${file}:${handler}`),
		).sort();

	it("are these seven pairs and no others", () => {
		assert.deepEqual(routed(), [
			"BriefPane.tsx:delete",
			"BriefPane.tsx:toggleRead",
			"FlaggedPane.tsx:delete",
			"FlaggedPane.tsx:toggleRead",
			"MailboxPane.tsx:delete",
			"MailboxPane.tsx:markJunk",
			"MailboxPane.tsx:toggleRead",
		]);
	});

	for (const entry of routed()) {
		const [file, handler] = entry.split(":");
		const verb = PANE_VERB_ROUTE[handler];

		it(`${entry} offers the list ${verb} before running anything`, () => {
			const body = paneVerbBody(read(file), handler);
			assert.notEqual(body, "", `${handler}'s body was found`);
			assert.match(body, new RegExp(`requestVerb\\("${verb}"\\)`));
		});

		it(`${entry} falls back to the focused row, never to a selection`, () => {
			const body = paneVerbBody(read(file), handler);
			assert.notEqual(body, "", `${handler}'s body was found`);
			assert.doesNotMatch(body, /selectedIds/i);
		});
	}
});

// The row is built once by `MailListHeader` and handed down as `makeFilterSlot`,
// but the wizard answering the step it pushes is mounted per surface. A surface
// that renders the row without one leaves the press on a URL nothing answers.
describe("the surfaces that render the make-filter row", () => {
	const ANSWERED_BY: Record<string, string> = {
		"DailyBrief.tsx": "DailyBrief.tsx",
		"MessageList.tsx": "MessageList.tsx",
		"ThreadListInteraction.tsx": "FlaggedList.tsx",
	};

	it("are these three and no others", () => {
		assert.deepEqual(
			sourceFiles()
				.filter((file) => /\.makeFilterSlot/.test(read(file)))
				.sort(),
			Object.keys(ANSWERED_BY).sort(),
		);
	});

	it("each name a file that mounts a wizard to answer the step", () => {
		for (const [surface, host] of Object.entries(ANSWERED_BY)) {
			assert.match(
				read(host),
				/<SelectionWizardHost/,
				`${surface} is answered by ${host}`,
			);
		}
	});
});
