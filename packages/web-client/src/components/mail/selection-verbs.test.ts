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

/** The bar element as written, up to its closing tag. */
const barMarkup = (source: string): string =>
	source.match(/<SelectionTopBar[\s\S]*?\n\t*\/>/)?.[0] ?? "";

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
	/** The verbs a pane can aim at a selection. Star and mute are per-sender. */
	const PANE_VERBS = ["delete", "toggleRead", "markJunk"];

	for (const file of LISTS) {
		it(`${file} publishes the one seam and claims a selection`, () => {
			const source = read(file);
			assert.match(source, /requestVerb,/);
			assert.match(
				source,
				/if \(verb !== "delete"/,
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

	for (const file of PANES) {
		it(`${file} offers the list every verb before running one`, () => {
			const source = read(file);
			const offered = Array.from(
				source.matchAll(/requestVerb\("(\w+)"\)/g),
				(match) => match[1],
			);
			for (const verb of PANE_VERBS) {
				const handler =
					source.includes(`${verb}: `) || source.includes(`${verb}:`);
				if (!handler) continue;
				assert.ok(
					offered.length > 0,
					`${file} handles ${verb} and must offer it to the list first`,
				);
			}
			assert.ok(
				offered.includes("delete"),
				`${file} routes delete through the list`,
			);
			assert.ok(
				offered.includes("markRead"),
				`${file} routes the read toggle through the list`,
			);
		});

		it(`${file} reads no selection straight out of the triage context`, () => {
			assert.doesNotMatch(
				read(file),
				/triage\.selectedIds\.length > 0/,
				"a verb picking the selection here is a verb the wizard never saw",
			);
		});
	}

	it("the mailbox pane routes junk through the list too", () => {
		const source = read("MailboxPane.tsx");
		assert.match(source, /requestVerb\("junk"\)/);
	});
});
