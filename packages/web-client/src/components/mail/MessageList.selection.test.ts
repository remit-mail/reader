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
			/shouldExitSelectionOnNavigate\(action, hasSelection\)/,
		);
		assert.match(source, /disabled: !hasSelection/);
	});
});

/**
 * An escalated selection is a predicate, so it has no id list to hand the
 * optimistic move/mark-read mutations — before #114 the bar simply dropped
 * both, leaving "select all 1,284 matching npm" able to delete and nothing
 * else. All three actions now page the predicate through the same run.
 */
describe("MessageList escalated actions", () => {
	it("routes move and mark-read through the predicate run when escalated", () => {
		assert.match(
			source,
			/escalation\.phase\.kind === "escalated"\)\s*\{\s*void runEscalatedAction\(MARK_READ_ACTION\);/,
		);
		assert.match(
			source,
			/escalation\.phase\.kind === "escalated"\)\s*\{\s*void runEscalatedAction\(\{ kind: "move", destinationMailboxId \}\);/,
		);
	});

	it("keeps mark-read and the move slot on an escalated selection", () => {
		// The mobile sheet always carries the mark-read verb (it hides it itself
		// while counting or busy); an escalated selection must never lose it.
		assert.match(source, /onMarkRead=\{handleMarkAsRead\}/);
		// The move slot is offered for a bounded selection or an escalated one —
		// #114's rule that an escalated selection is never delete-only.
		assert.match(
			source,
			/onMoveMessages \|\| escalation\.phase\.kind === "escalated"/,
		);
	});

	it("words progress and completion per action instead of per delete", () => {
		assert.match(
			source,
			/bulkActionProgressLabel\(\s*escalation\.runningAction\.kind,/,
		);
		assert.match(
			source,
			/bulkActionCompletionText\(action\.kind, outcome\.done\)/,
		);
	});
});

/**
 * A bounded confirm-delete used to open the surviving neighbour by writing
 * `selectedMessageId` into the URL. On desktop that fills the reading pane
 * beside the list; on a single-pane mobile layout the same navigation replaced
 * the list with a full-screen message, so a bulk delete read as "jumped into a
 * random message" rather than "the rows are gone" (#202). Mobile now stays on
 * the list and raises the same completion banner a chunked run does.
 */
describe("MessageList bounded delete stays on the list on mobile (#202)", () => {
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
