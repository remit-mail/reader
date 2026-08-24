/**
 * The roll-call no run can take: which surfaces exist, and which function each
 * one's verbs name.
 *
 * Everything a selection surface *does* — the review screen naming what a verb
 * covers, a run reaching the mail server — is driven end to end by
 * `packages/e2e`. What no run observes is a surface that was never wired: a
 * fourth pane growing its own direct handler while every other route was moved,
 * a fourth list rendering the make-filter row with no wizard behind it, or a
 * verb on a bar nobody presses in a spec quietly keeping a direct call. The
 * suite has locators for Delete, Move and Organize and none for Junk or
 * Mark-read, so three of the five are reachable only from here.
 *
 * So this reads the source, and reads it for the census: who raises a bar, what
 * each of its verbs is wired to, who declares a keyboard verb over a selection,
 * who renders the make-filter row. Every census is discovered from the
 * directory rather than listed, so a fourth surface is a failure here until it
 * is wired like the other three.
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

/**
 * How a surface may answer a verb prop. `startWizard`/`wizard.start`/
 * `startSelectionVerb` open the wizard on the verb; `organizeSelection` and
 * `startFromSearch` open it on the search entry, which is the same wizard
 * reached by its other door (#477 1.8). Anything else routes around the review
 * screen that names what the verb covers (#477 1.4).
 */
const OPENS_THE_WIZARD =
	/^(startWizard|wizard\.start|startSelectionVerb|organizeSelection|startFromSearch)\b/;

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

/**
 * The bar element as written, to its own closing tag. Found by matching tags
 * rather than by stopping at the first `/>` on a line: a nested self-closing
 * element matches that too, so the scan would end early and silently skip
 * whatever a surface happened to write after it.
 */
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

/**
 * What a verb prop is wired to, with the whitespace, the guard a verb is
 * offered behind, and the arrow taken off — what is left is the call itself.
 */
const verbHandler = (bar: string, prop: string): string | undefined => {
	const assigned = bar.match(new RegExp(`${prop}=\\{([\\s\\S]*?)\\}\\n`))?.[1];
	if (assigned === undefined) return undefined;
	return assigned
		.replace(/\s+/g, " ")
		.replace(/^.*? \? /, "")
		.replace(/ : undefined$/, "")
		.replace(/^\(\)\s*=>\s*/, "")
		.trim();
};

const declaredHandlers = (source: string): string[] => {
	const at = source.indexOf("handlers: {");
	if (at === -1) return [];
	return Array.from(
		bracedFrom(source, source.indexOf("{", at)).matchAll(/\n\t{3}(\w+): /g),
		(match) => match[1],
	);
};

/**
 * What a pane does for one keyboard verb: the handler it wired into the triage
 * layer, plus any callback that handler defers to for its target. A handler
 * that offers the list the press and then falls through to a helper picking the
 * selection is exactly as wrong as one picking it inline, so both are read.
 */
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

	for (const file of surfaces()) {
		it(`${file} routes every verb it offers through the wizard`, () => {
			const bar = barMarkup(read(file));
			assert.notEqual(bar, "", `${file} renders a SelectionTopBar`);
			const offered = BAR_VERB_PROPS.filter((prop) => bar.includes(`${prop}=`));
			assert.ok(offered.length > 0, `${file} offers at least one verb`);
			for (const prop of offered) {
				const handler = verbHandler(bar, prop);
				assert.ok(handler, `${file}'s ${prop} is wired to something`);
				assert.match(
					handler,
					OPENS_THE_WIZARD,
					`${file}'s ${prop} must open the wizard, not run the verb`,
				);
			}
		});
	}

	for (const file of ["DailyBrief.tsx", "MessageList.tsx"]) {
		it(`${file} drops none of the five verbs from the bar it raises`, () => {
			const bar = barMarkup(read(file));
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
	const PANE_VERB_ROUTE: Record<string, string> = {
		delete: "delete",
		toggleRead: "markRead",
		markJunk: "junk",
	};

	const panes = (): string[] =>
		sourceFiles()
			.filter((file) => read(file).includes("handlers: {"))
			.sort();

	const routed = (): string[] =>
		panes()
			.flatMap((file) =>
				declaredHandlers(read(file))
					.filter((handler) => handler in PANE_VERB_ROUTE)
					.map((handler) => `${file}:${handler}`),
			)
			.sort();

	it("are these three panes and no others", () => {
		assert.deepEqual(panes(), [
			"BriefPane.tsx",
			"FlaggedPane.tsx",
			"MailboxPane.tsx",
		]);
	});

	it("declare these seven routed handlers and no others", () => {
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
