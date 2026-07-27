import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	AddChipButton,
	ClauseChip,
	ClauseEditor,
	WidenChip,
} from "./filter-clause-chip.js";
import { FilterPreviewCount } from "./filter-preview-count.js";
import {
	type ClauseField,
	clauseFieldHint,
	clauseFieldLabel,
	clauseFieldOrder,
	commitBlockedReason,
	commitLabel,
	demoRule,
	demoSenderFallbackRule,
	demoVocabularyRule,
	type FilterRule,
	type FolderOption,
	type LabelOption,
	matchJoinWord,
	matchOperatorLabel,
	type PreviewCount,
	previewCountSummary,
	type RuleScope,
	scopeLabel,
	widenChipLabel,
} from "./filter-rule.js";
import {
	FilterRuleDialog,
	FilterRuleEditor,
	type FilterRuleEditorProps,
	FilterRuleSheet,
} from "./filter-rule-editor.js";

/** SSR splits interpolations with comment markers; sentences read across them. */
const render = (element: Parameters<typeof renderToString>[0]) =>
	renderToString(element).replaceAll("<!-- -->", "");

const FOLDERS: FolderOption[] = [
	{ id: "mbx-inbox", label: "Inbox" },
	{ id: "mbx-archive", label: "Archive" },
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
			semanticAvailable: true,
			...overrides,
		}),
	);

describe("filter-rule model", () => {
	it("labels every clause field", () => {
		const labels = clauseFieldOrder.map(clauseFieldLabel);
		assert.deepEqual(labels, [
			"From",
			"Subject",
			"Has the words",
			"List",
			"Domain",
		]);
	});

	it("joins clauses with and/or by operator", () => {
		assert.equal(matchJoinWord("all"), "and");
		assert.equal(matchJoinWord("any"), "or");
	});

	it("names the operators and scopes for the toggles", () => {
		assert.equal(matchOperatorLabel("all"), "Match all");
		assert.equal(matchOperatorLabel("any"), "Match any");
		const scopes: RuleScope[] = ["once", "standing", "until"];
		assert.deepEqual(scopes.map(scopeLabel), [
			"Just once",
			"Keep doing this",
			"Until a date",
		]);
	});

	it("labels the widen chip with its anchor count", () => {
		assert.equal(widenChipLabel({ anchorCount: 2 }), "Similar to these 2");
	});

	it("labels the commit by scope", () => {
		assert.equal(commitLabel("once"), "Apply now");
		assert.equal(commitLabel("standing"), "Save rule");
		assert.equal(commitLabel("until"), "Save until then");
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

	it("an active widen alone is a matcher", () => {
		assert.equal(
			commitBlockedReason(
				{ ...base, clauses: [], widen: { anchorCount: 2 } },
				fresh,
			),
			undefined,
		);
	});

	it("an inactive widen alone is not a matcher", () => {
		assert.match(
			commitBlockedReason(
				{ ...base, clauses: [], widen: { anchorCount: 2, inactive: true } },
				fresh,
			) ?? "",
			/Add a clause/,
		);
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

describe("WidenChip", () => {
	it("offers a removable similar-mail chip with the anchor count", () => {
		const html = render(
			createElement(WidenChip, {
				widen: { anchorCount: 3 },
				onRemove: () => {},
			}),
		);
		assert.match(html, /and anything similar/);
		assert.match(html, /Similar to these 3/);
		assert.match(html, /aria-label="Remove the similar-mail widen"/);
	});

	it("marks a degraded widen inactive but keeps it removable", () => {
		const html = render(
			createElement(WidenChip, {
				widen: { anchorCount: 2, inactive: true },
				onRemove: () => {},
			}),
		);
		assert.match(html, /not available here/);
		assert.match(html, /line-through/);
		assert.match(html, /aria-label="Remove the similar-mail widen"/);
	});
});

describe("AddChipButton", () => {
	it("renders its label", () => {
		const html = render(createElement(AddChipButton, { label: "Add clause" }));
		assert.match(html, /Add clause/);
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

	it("labels the submit Save when editing", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "Subject", value: "invoice" },
				mode: "edit",
			}),
		);
		assert.match(html, />Save</);
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

	it("carries no hint for the self-evident fields", () => {
		const html = render(
			createElement(ClauseEditor, {
				draft: { field: "Subject", value: "" },
				mode: "add",
			}),
		);
		assert.doesNotMatch(html, /registrable domain/i);
		assert.doesNotMatch(html, /List-Id/);
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

describe("clauseFieldHint", () => {
	it("explains ListId and FromDomain, and leaves the plain fields unexplained", () => {
		assert.match(clauseFieldHint("ListId") ?? "", /List-Id/);
		assert.match(clauseFieldHint("FromDomain") ?? "", /registrable domain/i);
		assert.equal(clauseFieldHint("From"), undefined);
		assert.equal(clauseFieldHint("Subject"), undefined);
		assert.equal(clauseFieldHint("HasWords"), undefined);
	});
});

describe("FilterPreviewCount", () => {
	it("shows a live loading state", () => {
		const html = render(
			createElement(FilterPreviewCount, { preview: { status: "loading" } }),
		);
		assert.match(html, /Counting matches/);
		assert.match(html, /aria-live/);
	});

	it("states zero without reading as an error", () => {
		const html = render(
			createElement(FilterPreviewCount, {
				preview: { status: "ready", count: 0 },
			}),
		);
		assert.match(html, /No mail matches yet/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("counts many matches", () => {
		const html = render(
			createElement(FilterPreviewCount, {
				preview: { status: "ready", count: 412 },
			}),
		);
		assert.match(html, /412 messages match/);
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
	it("renders clause chips joined by the operator word", () => {
		const html = editor();
		assert.match(html, /notifications@github\.com/);
		assert.match(html, /pull request/);
		assert.match(html, /and/);
	});

	it("joins with or when matching any", () => {
		const html = editor({ rule: demoVocabularyRule });
		assert.match(html, /python-dev\.python\.org/);
		assert.match(html, /python\.org/);
		assert.match(html, /nightly build/);
		assert.match(html, /or/);
	});

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

	it("offers the widen add only when the deployment can serve it", () => {
		const noWiden: FilterRule = { ...demoRule, widen: undefined };
		assert.match(
			editor({ rule: noWiden, semanticAvailable: true }),
			/…and similar/,
		);
		assert.doesNotMatch(
			editor({ rule: noWiden, semanticAvailable: false }),
			/…and similar/,
		);
	});

	it("renders a present widen even where the capability is absent", () => {
		const html = editor({
			rule: {
				...demoRule,
				widen: { anchorCount: 2, inactive: true },
			},
			semanticAvailable: false,
		});
		assert.match(html, /not available here/);
	});

	it("drops the join word before an inactive widen chip", () => {
		const joins = (html: string) =>
			html.match(/uppercase text-fg-subtle">and</g)?.length ?? 0;
		assert.equal(joins(editor()), 2);
		assert.equal(
			joins(
				editor({
					rule: { ...demoRule, widen: { anchorCount: 2, inactive: true } },
					semanticAvailable: false,
				}),
			),
			1,
		);
	});

	it("keeps a degraded widen removable in the editor", () => {
		const html = editor({
			rule: { ...demoRule, widen: { anchorCount: 2, inactive: true } },
			semanticAvailable: false,
			onRemoveWiden: () => {},
		});
		assert.match(html, /aria-label="Remove the similar-mail widen"/);
	});

	it("blocks the commit while the previewed set is recounting", () => {
		const html = editor({
			preview: { status: "ready", count: 47, stale: true },
		});
		assert.match(html, /role="status"/);
		assert.match(html, /count settles/);
		assert.match(html, /disabled/);
	});

	it("renders the sender-fallback From chips as ordinary editable chips", () => {
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

	it("renders a chip for the selected label", () => {
		const html = editor({
			labels: LABELS,
			rule: { ...demoRule, labelId: "lbl-receipts" },
		});
		assert.match(html, /Receipts/);
	});

	it("offers no create option without onCreateLabel", () => {
		const html = editor({ labels: LABELS });
		assert.doesNotMatch(html, /New label…/);
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

	it("drives the commit label from the scope", () => {
		assert.match(editor(), /Save rule/);
		assert.match(editor({ rule: { ...demoRule, scope: "once" } }), /Apply now/);
	});

	it("states why the commit is blocked instead of only disabling it", () => {
		const html = editor({
			rule: { ...demoRule, moveMailboxId: undefined },
		});
		assert.match(html, /role="status"/);
		assert.match(html, /Pick a folder/);
	});

	it("renders the inline clause editor when adding", () => {
		const html = editor({
			clauseEdit: { mode: "add", draft: { field: "From", value: "" } },
		});
		assert.match(html, /aria-label="Clause value"/);
		assert.doesNotMatch(html, /Add clause/);
	});

	it("shows the live preview region", () => {
		assert.match(editor(), /47 messages match/);
	});

	it("keeps scope and expiry live and editable on an anchor-locked (existing) filter (reader #266)", () => {
		const html = editor({
			rule: { ...demoRule, scope: "until", until: "2027-09-01" },
			anchorLocked: true,
		});
		assert.match(html, /aria-label="Rule scope"/);
		assert.match(html, /aria-label="Expiry date"/);
		assert.match(html, /aria-label="Rule name"/);
	});

	it("drops the once option from the scope toggle on an anchor-locked filter", () => {
		const locked = editor({ anchorLocked: true });
		assert.doesNotMatch(locked, />Just once</);
		const unlocked = editor({ anchorLocked: false });
		assert.match(unlocked, />Just once</);
	});

	it("locks the widen chip and explains why only when one is present", () => {
		const withWiden = editor({
			rule: { ...demoRule, widen: { anchorCount: 2 } },
			anchorLocked: true,
		});
		assert.doesNotMatch(
			withWiden,
			/aria-label="Remove the similar-mail widen"/,
		);
		assert.match(withWiden, /similar-mail match is fixed to the message/);

		const literal = editor({
			rule: { ...demoRule, widen: undefined },
			anchorLocked: true,
		});
		assert.doesNotMatch(literal, /similar-mail match is fixed/);
	});

	it("never offers to add a widen on an anchor-locked filter, even when the deployment can serve it", () => {
		const html = editor({
			rule: { ...demoRule, widen: undefined },
			anchorLocked: true,
			semanticAvailable: true,
		});
		assert.doesNotMatch(html, /…and similar/);
	});
});

describe("FilterRuleDialog", () => {
	it("renders the editor when open", () => {
		const html = render(
			createElement(FilterRuleDialog, {
				open: true,
				onClose: () => {},
				rule: demoRule,
				folders: FOLDERS,
				preview: READY,
			}),
		);
		assert.match(html, /role="dialog"/);
		assert.match(html, /Filter rule/);
	});

	it("renders nothing when closed", () => {
		assert.equal(
			renderToString(
				createElement(FilterRuleDialog, {
					open: false,
					onClose: () => {},
					rule: demoRule,
					folders: FOLDERS,
					preview: READY,
				}),
			),
			"",
		);
	});
});

describe("FilterRuleSheet", () => {
	it("renders the editor inside a dismissible sheet", () => {
		const html = render(
			createElement(FilterRuleSheet, {
				open: true,
				onClose: () => {},
				rule: demoRule,
				folders: FOLDERS,
				preview: READY,
			}),
		);
		assert.match(html, /Dismiss filter rule/);
		assert.match(html, /Filter rule/);
	});
});
