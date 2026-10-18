import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ClauseChip, ClauseEditor } from "./filter-clause-chip.js";
import { FilterPreviewCount } from "./filter-preview-count.js";
import {
	type ClauseField,
	clauseFieldLabel,
	commitBlockedReason,
	demoRule,
	demoSenderFallbackRule,
	type FilterRule,
	type LabelOption,
	matchJoinWord,
	type PreviewCount,
	previewCountSummary,
} from "./filter-rule.js";
import {
	FilterRuleEditor,
	type FilterRuleEditorProps,
} from "./filter-rule-editor.js";
import type { FolderTreeNode } from "./folder-tree-picker.js";

/** SSR splits interpolations with comment markers; sentences read across them. */
const render = (element: Parameters<typeof renderToString>[0]) =>
	renderToString(element).replaceAll("<!-- -->", "");

const FOLDERS: FolderTreeNode[] = [
	{ id: "mbx-inbox", label: "Inbox", path: "INBOX" },
	{ id: "mbx-archive", label: "Archive", path: "INBOX/Archive" },
];

const LABELS: LabelOption[] = [
	{ id: "lbl-receipts", name: "Receipts", color: "Blue" },
	{ id: "lbl-travel", name: "Travel", color: "Green" },
];

const READY: PreviewCount = { status: "ready", count: 47 };

const editor = (overrides: Partial<FilterRuleEditorProps> = {}) =>
	render(
		createElement(FilterRuleEditor, {
			rule: demoRule,
			folders: FOLDERS,
			preview: READY,
			...overrides,
		}),
	);

describe("filter-rule model", () => {
	it("joins clauses with and/or by operator", () => {
		assert.equal(matchJoinWord("all"), "and");
		assert.equal(matchJoinWord("any"), "or");
	});

	it("summarises every preview state", () => {
		assert.match(previewCountSummary({ status: "loading" }), /Counting/);
		assert.equal(
			previewCountSummary({ status: "ready", count: 0 }),
			"No mail matches yet",
		);
		assert.equal(
			previewCountSummary({ status: "ready", count: 1 }),
			"1 message match",
		);
		assert.equal(
			previewCountSummary({ status: "ready", count: 9 }),
			"9 messages match",
		);
		assert.match(
			previewCountSummary({ status: "ready", count: 9, stale: true }),
			/recounting/,
		);
		assert.equal(
			previewCountSummary({ status: "error", reason: "server said no" }),
			"server said no",
		);
	});
});

describe("commitBlockedReason", () => {
	const base: FilterRule = {
		clauses: [{ id: "c", field: "From", value: "a@b.com" }],
		matchOperator: "all",
		moveMailboxId: "mbx-archive",
		scope: "once",
	};
	const fresh: PreviewCount = { status: "ready", count: 5 };

	it("clears when a one-time rule has a matcher, a folder, and a settled count", () => {
		assert.equal(commitBlockedReason(base, fresh), undefined);
	});

	it("asks for a matcher when there is none", () => {
		assert.match(
			commitBlockedReason({ ...base, clauses: [] }, fresh) ?? "",
			/Add a clause/,
		);
	});

	it("asks for a folder or a label when neither action is chosen", () => {
		assert.match(
			commitBlockedReason({ ...base, moveMailboxId: undefined }, fresh) ?? "",
			/Pick a folder to move into, or a label to apply/,
		);
	});

	it("a label alone is a sufficient action, no folder needed", () => {
		assert.equal(
			commitBlockedReason(
				{ ...base, moveMailboxId: undefined, labelId: "lbl-1" },
				fresh,
			),
			undefined,
		);
	});

	it("asks a standing rule for a name", () => {
		assert.match(
			commitBlockedReason({ ...base, scope: "standing", name: "  " }, fresh) ??
				"",
			/Name this rule/,
		);
	});

	it("asks a timed rule for a date", () => {
		assert.match(
			commitBlockedReason({ ...base, scope: "until", name: "x" }, fresh) ?? "",
			/date this rule should stop/,
		);
	});

	it("blocks a well-formed rule while the count is still loading", () => {
		assert.match(
			commitBlockedReason(base, { status: "loading" }) ?? "",
			/count settles/,
		);
	});

	it("blocks a well-formed rule while the count is stale", () => {
		assert.match(
			commitBlockedReason(base, { status: "ready", count: 5, stale: true }) ??
				"",
			/count settles/,
		);
	});

	it("does not gate on a preview error — the count region raises that", () => {
		assert.equal(
			commitBlockedReason(base, { status: "error", reason: "boom" }),
			undefined,
		);
	});
});

describe("ClauseChip", () => {
	it("shows the field and value and both affordances", () => {
		const html = render(
			createElement(ClauseChip, {
				clause: { id: "c", field: "Subject", value: "invoice" },
				onEdit: () => {},
				onRemove: () => {},
			}),
		);
		assert.match(html, /Subject/);
		assert.match(html, /invoice/);
		assert.match(html, /aria-label="Edit Subject clause"/);
		assert.match(html, /aria-label="Remove Subject clause"/);
	});

	it("marks a sender-derived From clause as visible and editable", () => {
		const html = render(
			createElement(ClauseChip, {
				clause: {
					id: "c",
					field: "From",
					value: "receipts@stripe.com",
					derived: true,
				},
				onEdit: () => {},
				onRemove: () => {},
			}),
		);
		assert.match(html, /from sender/);
		assert.match(html, /receipts@stripe\.com/);
		assert.match(html, /border-dashed/);
	});

	it("renders the ListId and FromDomain variants for ticket B", () => {
		const fields: ClauseField[] = ["ListId", "FromDomain"];
		for (const field of fields) {
			const html = render(
				createElement(ClauseChip, {
					clause: { id: "c", field, value: "x" },
				}),
			);
			assert.match(html, new RegExp(clauseFieldLabel(field)));
		}
	});
});

describe("ClauseEditor", () => {
	it("offers the field picker and a value input when adding", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "From", value: "" },
				mode: "add",
			}),
		);
		assert.match(html, /aria-label="Clause field"/);
		assert.match(html, /aria-label="Clause value"/);
		assert.match(html, />Add</);
	});

	it("offers only the fields a consumer allows, so it never proposes a clause the backend can't match", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "From", value: "" },
				mode: "add",
				fields: ["From", "Subject", "HasWords"],
			}),
		);
		assert.match(html, />From</);
		assert.match(html, />Subject</);
		assert.doesNotMatch(html, /value="ListId"/);
		assert.doesNotMatch(html, /value="FromDomain"/);
	});

	it("shows the ListId hint — what it matches and the forward-only caveat", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "ListId", value: "" },
				mode: "add",
			}),
		);
		assert.match(html, /List-Id/);
		assert.match(html, /matched as it arrives/i);
	});

	it("shows the FromDomain hint — the registrable domain, look-alikes excluded", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "FromDomain", value: "" },
				mode: "add",
			}),
		);
		assert.match(html, /registrable domain/i);
	});

	it("is a plain text box when there is nothing to suggest", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "From", value: "" },
				mode: "add",
			}),
		);
		assert.doesNotMatch(html, /role="listbox"/);
		assert.match(html, /aria-expanded="false"/);
	});

	it("offers the suggestions under the row, named for the field being edited", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "From", value: "" },
				mode: "add",
				suggestions: [
					{
						value: "receipts@stripe.com",
						label: "Stripe",
						hint: "receipts@stripe.com",
						source: "selected",
					},
					{ value: "rides@lyft.com" },
				],
			}),
		);
		assert.match(html, /role="listbox"/);
		assert.match(html, /aria-label="From suggestions"/);
		assert.match(html, /aria-expanded="true"/);
		assert.match(html, /receipts@stripe\.com/);
	});
});

describe("FilterPreviewCount", () => {
	it("states zero without reading as an error", () => {
		const html = render(
			createElement(FilterPreviewCount, {
				preview: { status: "ready", count: 0 },
			}),
		);
		assert.match(html, /No mail matches yet/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("marks a changed set as recounting rather than blank", () => {
		const html = render(
			createElement(FilterPreviewCount, {
				preview: { status: "ready", count: 47, stale: true },
			}),
		);
		assert.match(html, /recounting/);
	});

	it("raises an alert on a preview error", () => {
		const html = render(
			createElement(FilterPreviewCount, {
				preview: { status: "error", reason: "preview failed" },
			}),
		);
		assert.match(html, /role="alert"/);
		assert.match(html, /preview failed/);
	});
});

describe("FilterRuleEditor", () => {
	it("shows the match-operator toggle only with two or more matchers", () => {
		assert.match(editor(), /aria-label="Match operator"/);
		const single = editor({
			rule: {
				clauses: [{ id: "c", field: "From", value: "a@b.com" }],
				matchOperator: "all",
				moveMailboxId: "mbx-archive",
				scope: "once",
			},
		});
		assert.doesNotMatch(single, /aria-label="Match operator"/);
	});

	it("blocks the commit while the previewed set is recounting", () => {
		const html = editor({
			preview: { status: "ready", count: 47, stale: true },
		});
		assert.match(html, /role="status"/);
		assert.match(html, /count settles/);
		assert.match(html, /disabled/);
	});

	it("renders derived From chips as ordinary editable chips", () => {
		const html = editor({ rule: demoSenderFallbackRule });
		assert.match(html, /receipts@stripe\.com/);
		assert.match(html, /receipts@lyft\.com/);
		assert.match(html, /from sender/);
	});

	it("offers the account's labels as the apply-label action", () => {
		const html = editor({ labels: LABELS });
		assert.match(html, /aria-label="Label to apply"/);
		assert.match(html, /Receipts/);
		assert.match(html, /Travel/);
	});

	it("offers the create option when onCreateLabel is wired", () => {
		const html = editor({
			labels: LABELS,
			onCreateLabel: () =>
				Promise.resolve({ id: "lbl-new", name: "New", color: "Default" }),
		});
		assert.match(html, /New label…/);
	});

	it("shows the scope toggle and names a standing rule", () => {
		const html = editor();
		assert.match(html, /aria-label="Rule scope"/);
		assert.match(html, /aria-label="Rule name"/);
	});

	it("asks for a date only on the until scope", () => {
		const timed = editor({
			rule: { ...demoRule, scope: "until", until: "2026-08-01" },
		});
		assert.match(timed, /aria-label="Expiry date"/);
		assert.doesNotMatch(editor(), /aria-label="Expiry date"/);
	});

	it("hides the name field for a one-time rule", () => {
		const once = editor({ rule: { ...demoRule, scope: "once" } });
		assert.doesNotMatch(once, /aria-label="Rule name"/);
	});

	it("states why the commit is blocked instead of only disabling it", () => {
		const html = editor({
			rule: { ...demoRule, moveMailboxId: undefined },
		});
		assert.match(html, /role="status"/);
		assert.match(html, /Pick a folder/);
	});

	it("keeps scope and expiry live and editable on a persisted filter (reader #266)", () => {
		const html = editor({
			rule: { ...demoRule, scope: "until", until: "2027-09-01" },
			persisted: true,
		});
		assert.match(html, /aria-label="Rule scope"/);
		assert.match(html, /aria-label="Expiry date"/);
		assert.match(html, /aria-label="Rule name"/);
	});

	it("drops the once option from the scope toggle on a persisted filter", () => {
		const persisted = editor({ persisted: true });
		assert.doesNotMatch(persisted, />Just once</);
		const fresh = editor({ persisted: false });
		assert.match(fresh, />Just once</);
	});
});
