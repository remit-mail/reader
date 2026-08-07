import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * One invariant, over every surface: a verb aimed at a selection reaches the
 * mail server only through the wizard, whose review screen names what it covers
 * (#477 1.4 and its FAQ, #508).
 *
 * There are two ways to ask for one — the selection bar and the keyboard — and
 * three surfaces that raise a bar. Checked here rather than by a spec per
 * surface, because what has repeatedly gone wrong is not a broken route but a
 * missing one: a fourth surface, or a sixth verb, quietly keeping a direct
 * handler while every other route was moved. That is invisible in review and
 * indistinguishable from correct until someone selects 3,412 messages and
 * presses a key.
 *
 * These read the source rather than rendering, for the reason
 * `MessageList.selection.test.ts` gives: these components wire the DOM, the
 * router and several data hooks together, and the rule is about which function
 * a prop names.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string =>
	readFileSync(resolve(here, file), "utf8");

/** Every verb the bar can carry — the props `SelectionTopBar` accepts. */
const BAR_VERB_PROPS = [
	"onDelete",
	"onMove",
	"onOrganize",
	"onJunk",
	"onMarkRead",
] as const;

/**
 * How a surface is allowed to answer a verb prop. `startWizard`/`wizard.start`/
 * `startSelectionVerb` all open the wizard on the verb; `organizeSelection` and
 * `startFromSearch` open it on the search entry, which is the same wizard
 * reached by its other door (#477 1.8). Anything else is a route around the
 * review screen.
 */
const OPENS_THE_WIZARD =
	/^(startWizard|wizard\.start|startSelectionVerb|organizeSelection|startFromSearch)\b/;

const surfaceFiles = (): string[] =>
	readdirSync(here)
		.filter((file) => file.endsWith(".tsx"))
		.filter((file) => /<SelectionTopBar/.test(read(file)));

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

/** The body of `const <name> = useCallback(…)`, or of an inline arrow value. */
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

/** The triage handlers a pane wires into the keyboard layer, by name. */
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

describe("every verb on a selection bar opens the wizard", () => {
	it("covers the surfaces that raise one", () => {
		assert.deepEqual(surfaceFiles().sort(), [
			"DailyBrief.tsx",
			"MessageList.tsx",
			"ThreadListInteraction.tsx",
		]);
	});

	for (const file of surfaceFiles()) {
		it(`${file} routes each verb it offers through the wizard`, () => {
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
});

/**
 * The keyboard's half. A list offers the pane one seam — `requestVerb` — and
 * claims the press whenever it has a selection, so a pane's own handler only
 * ever sees a verb aimed at the bare cursor. A pane that runs a verb over
 * `selectedIds` without offering the list the press first is the hole this
 * binds shut.
 */
describe("every keyboard verb over a selection goes through the list", () => {
	const LISTS = ["MessageList.tsx", "ThreadListInteraction.tsx"];
	const PANES = ["MailboxPane.tsx", "BriefPane.tsx", "FlaggedPane.tsx"];
	/**
	 * The triage handlers that can be aimed at a selection, each with the wizard
	 * verb it has to route to. Star is a knowing carve-out: it is not one of the
	 * five verbs the wizard walks, it is not on `SelectionTopBar`, and it sets a
	 * flag on mail already in front of the user that the same key unsets — so
	 * there is nothing for a review screen to name. `LabelApplyTrigger` applies
	 * labels to the selection directly for the same reason, and because labels
	 * are out of scope for the epic that put the wizard in front of the rest
	 * (#477 §6). Mute and block are per-sender and reach no selection at all.
	 */
	const PANE_VERB_ROUTE: Record<string, string> = {
		delete: "delete",
		toggleRead: "markRead",
		markJunk: "junk",
	};

	/**
	 * How a list may answer a verb aimed at the bare cursor: with the shared
	 * decision, whose rules are in `../../lib/list-verb-request.test.ts`, or
	 * inline. Either way only Delete is the list's.
	 */
	const CURSOR_DELETE_ONLY = /listVerbRequest\(\{|if \(verb !== "delete"/;

	for (const file of LISTS) {
		it(`${file} publishes the one seam and claims a selection`, () => {
			const source = read(file);
			assert.match(source, /requestVerb,/);
			assert.match(
				source,
				CURSOR_DELETE_ONLY,
				"only delete is the list's over a bare cursor",
			);
			assert.doesNotMatch(
				source,
				/requestDelete:/,
				"one seam, so no verb can have a second one",
			);
		});

		it(`${file} stands its keyboard down while the wizard is up`, () => {
			assert.match(
				read(file),
				/blocksKeyboard: confirmOpen \|\| wizard/,
				"a shortcut must not act behind the screen already asking",
			);
		});
	}

	// Only the handlers a pane really declares get a case, so a pane that never
	// wired one cannot pass by skipping — the roll-call below is what notices a
	// handler nobody routed.
	for (const file of PANES) {
		for (const handler of declaredHandlers(read(file))) {
			const verb = PANE_VERB_ROUTE[handler];
			if (verb === undefined) continue;

			it(`${file}'s ${handler} offers the list ${verb} first`, () => {
				const body = paneVerbBody(read(file), handler);
				assert.notEqual(body, "", `${handler}'s body was found`);
				assert.match(
					body,
					new RegExp(`requestVerb\\("${verb}"\\)`),
					`${handler} must hand ${verb} to the list before running it`,
				);
			});

			it(`${file}'s ${handler} aims at the cursor once the list declines`, () => {
				const body = paneVerbBody(read(file), handler);
				assert.notEqual(body, "", `${handler}'s body was found`);
				// The list declines only when its commands are gone, which an
				// escalated selection outlives — so a fallback that could still see
				// a selection would run the verb over a stale snapshot of rows that
				// are no longer loaded, with no wizard in front of it.
				assert.doesNotMatch(
					body,
					/selectedIds/i,
					`${handler} falls back to the focused row, never to a selection`,
				);
			});
		}
	}

	it("checks the routed handler on every pane that declares one", () => {
		// The roll-call. Each pair above is generated from what a pane declares, so
		// this is what says the generation reached everything it should have — a
		// handler that stops being declared, or a body the reader stops finding,
		// shows up here as a missing pair rather than as a case that passed by
		// doing nothing.
		const checked = PANES.flatMap((file) =>
			declaredHandlers(read(file))
				.filter((handler) => handler in PANE_VERB_ROUTE)
				.map((handler) => `${file}:${handler}`),
		);
		assert.deepEqual(checked.sort(), [
			"BriefPane.tsx:delete",
			"BriefPane.tsx:toggleRead",
			"FlaggedPane.tsx:delete",
			"FlaggedPane.tsx:toggleRead",
			"MailboxPane.tsx:delete",
			"MailboxPane.tsx:markJunk",
			"MailboxPane.tsx:toggleRead",
		]);
		for (const entry of checked) {
			const [file, handler] = entry.split(":");
			assert.notEqual(paneVerbBody(read(file), handler), "", entry);
		}
	});
});
