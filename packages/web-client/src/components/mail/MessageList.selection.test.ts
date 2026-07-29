import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Selection mode has one source of truth and one exit (#115). `MessageList`
 * wires the DOM, the virtualizer, routing and several data hooks together, so
 * — as with this package's other component-level rules (see
 * `../../index.css.test.ts`) — the rule is enforced by reading the source
 * rather than rendering the tree. The decisions themselves are unit-tested in
 * `../../lib/selection-mode.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "MessageList.tsx"), "utf8");

describe("MessageList selection mode", () => {
	it("keeps no selection-mode flag of its own", () => {
		assert.doesNotMatch(source, /useState[^\n]*[iI]sMultiSelectMode/);
		assert.doesNotMatch(source, /setIsMultiSelectMode/);
	});

	it("derives the mode from the selection count", () => {
		assert.match(
			source,
			/const isMultiSelectMode = deriveIsMultiSelectMode\(\s*selectedCount,/,
		);
	});

	it("calls the selection hook's clearSelection from exactly one place", () => {
		const calls = source.match(/\bclearSelection\(\)/g) ?? [];
		assert.equal(calls.length, 1);
		assert.match(
			source,
			/const exitSelection = useCallback\(\(\) => \{[^}]*clearSelection\(\);/,
		);
	});

	it("exits selection when the mailbox changes", () => {
		assert.match(source, /previousMailboxIdRef\.current === mailboxId/);
	});

	it("turns the back gesture into an exit, and only while selecting", () => {
		assert.match(
			source,
			/shouldExitSelectionOnNavigate\(action, hasSelection, wizardStep\)/,
		);
		assert.match(source, /disabled: !hasSelection/);
	});

	it("leaves the back gesture to the wizard while the wizard is open", () => {
		assert.match(
			source,
			/disabled: !hasSelection \|\| wizardStep !== undefined/,
		);
	});
});

/**
 * An escalated selection is a predicate, and it walks the same wizard every
 * other selection walks (#508). The list hands the wizard the predicate — the
 * words it names it with, the count it was escalated to, and the chunked runner
 * that re-resolves it — and keeps no second confirmation of its own.
 */
describe("MessageList escalated actions", () => {
	it("hands the escalated predicate to the wizard rather than running it here", () => {
		assert.match(
			source,
			/const escalatedSelection: EscalatedSelection \| undefined =\s*escalation\.phase\.kind === "escalated"/,
		);
		assert.match(
			source,
			/scope: describeSearchScope\(searchPredicate \?\? \{\}\)/,
		);
		assert.match(source, /total: escalation\.phase\.total/);
		assert.match(
			source,
			/run: \(action: EscalatedAction\) => escalation\.runAction\(action\)/,
		);
		const host = source.match(/<SelectionWizardHost[\s\S]*?\/>/)?.[0] ?? "";
		assert.match(host, /escalated=\{escalatedSelection\}/);
	});

	it("keeps no predicate confirmation of its own", () => {
		// The review screen names what the predicate covers; a second dialog
		// asking the same question is the drift the wizard exists to end.
		assert.doesNotMatch(source, /source: "predicate"/);
		assert.doesNotMatch(source, /requestEscalatedDelete/);
		assert.doesNotMatch(source, /pendingDeleteIsEstimate/);
	});

	it("words the bar's progress per action instead of per delete", () => {
		assert.match(
			source,
			/bulkActionProgressLabel\(\s*escalation\.runningAction\.kind,/,
		);
	});
});

/**
 * Advanced selection is no longer mobile-only (#212): the escalation engine is
 * opened to every width, and the one selection bar renders the
 * offer → counting → escalated → progress → notice states.
 */
describe("MessageList escalation reaches desktop (#212)", () => {
	it("no longer gates the escalation engine on the mobile viewport", () => {
		assert.match(
			source,
			/const escalationEnabled = isSearching && !!searchPredicate;/,
		);
		assert.doesNotMatch(
			source,
			/!isDesktop && isSearching && !!searchPredicate/,
		);
	});

	it("feeds the bar the shared escalation state", () => {
		// Up to the bar's own closing tag, at its own indent — a nested slot
		// element closes first and would cut the match short.
		const bar = source.match(/<SelectionTopBar[\s\S]*?\n\t\t\/>/)?.[0] ?? "";
		assert.match(bar, /statusLabel=\{selectionStatusLabel\}/);
		assert.match(bar, /notice=\{selectionNotice\}/);
		assert.match(bar, /progress=\{selectionProgress\}/);
		assert.match(bar, /selectAll=\{selectionSelectAll\}/);
		assert.match(bar, /isCounting=\{escalation\.phase\.kind === "counting"\}/);
	});

	it("raises one selection surface, at every width (#480)", () => {
		const bars = source.match(/<SelectionTopBar\b/g) ?? [];
		assert.equal(bars.length, 1, "one bar, so no two surfaces can drift");
		assert.doesNotMatch(source, /<SelectionSheet\b/);
	});

	it("mounts that surface unconditionally — it is the list header", () => {
		// Gated on a selection, the bar's zero-ticked state (the mailbox name,
		// and select-all inline from 768px up) reaches nothing.
		assert.match(source, /const activeSelectionBar = \(\s*<SelectionTopBar/);
		assert.match(source, /title=\{listHeaderChrome\.title \|\| listTitle\}/);
		assert.match(source, /navSlot=\{listHeaderChrome\.navSlot\}/);
	});

	it("carries every verb the bar can offer (#477 1.4)", () => {
		// That each of them opens the wizard is `selection-verbs.test.ts`, over
		// every surface at once. What this pins is that none of them was dropped
		// from the one bar the mailbox raises.
		const bar = source.match(/<SelectionTopBar[\s\S]*?\n\t\t\/>/)?.[0] ?? "";
		for (const prop of [
			"onDelete",
			"onMove",
			"onOrganize",
			"onJunk",
			"onMarkRead",
		]) {
			assert.match(bar, new RegExp(`${prop}=`));
		}
		// The one selection surface has no second organize entry beside them.
		assert.doesNotMatch(source, /onSomethingElse/);
	});

	it("keeps Organize reachable over a predicate rather than dropping it", () => {
		// A verb that vanishes when a selection escalates leaves the user no route
		// at all: the make-filter affordance it defers to is hidden while rows are
		// ticked (#477 1.7).
		assert.match(source, /if \(escalatedSelection\) \{\s*startFromSearch\(\);/);
	});

	it("offers the label picker only when the account has labels", () => {
		assert.match(source, /labels\.length > 0 \? \(/);
	});
});

/**
 * A confirmed delete used to open the surviving neighbour by writing
 * `selectedMessageId` into the URL. On desktop that fills the reading pane
 * beside the list; on a single-pane mobile layout the same navigation replaced
 * the list with a full-screen message, so the delete read as "jumped into a
 * random message" rather than "the row is gone" (#202). Mobile now stays on the
 * list and raises a completion banner instead.
 */
describe("MessageList confirmed delete stays on the list on mobile (#202)", () => {
	it("only the desktop two-pane opens the surviving neighbour after a delete", () => {
		assert.match(
			source,
			/if \(isDesktop\) \{\s*navigate\(\{\s*to: "\/mail\/\$mailboxId",\s*params: \{ mailboxId \},\s*search: \(prev\) => \(\{ \.\.\.prev, selectedMessageId: nextFocus \}\),\s*replace: true,\s*\}\);\s*\}/,
		);
	});

	it("raises a completion banner on mobile so the delete is not silent", () => {
		assert.match(
			source,
			/if \(!isDesktop\) \{\s*setCompletionBanner\(\s*bulkActionCompletionText\("delete", ids\.length\),?\s*\);\s*\}/,
		);
	});
});
