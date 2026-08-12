import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { generateLayoutClampCSS } from "../lib/email-layout-clamp.js";
import { IsolatedEmailFrame } from "./isolated-email-frame.js";

/**
 * `IsolatedEmailFrame` renders sanitized email HTML in a sandboxed iframe that is
 * exactly as wide as the box holding it and isolates the email's CSS from the
 * app.
 *
 * The component receives HTML that already carries the sanitizer's layout-clamp
 * `<style>` block, so these stories prepend the same clamp CSS to each fixture
 * to reproduce the real pipeline. The fixtures are the real failing emails from
 * the #727 patch chain — fixed-width `<table width="600">` newsletters that
 * overflowed a phone — rendered at a phone width and at a desktop
 * reading-column width.
 *
 * The app's layout never reacts to what is inside the frame. Mail that can
 * reflow does, against the pane's width; mail that genuinely cannot — a table
 * with its own `min-width`, an image the same, a `pre` the author pinned —
 * scrolls inside the document, and neither the pane nor the page moves sideways
 * at any width.
 */

// The sanitizer's own clamp — clamps wide author markup (fixed-width
// tables/cells, oversized media) to the frame width and wraps long unbroken
// tokens. In the app the sanitizer prepends it; here the fixtures prepend the
// same generated stylesheet, so a rule that changes there changes here.
const LAYOUT_CLAMP_CSS = `<style>${generateLayoutClampCSS()}</style>`;

const HERO = `data:image/svg+xml;utf8,${encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">
		<rect width="600" height="200" fill="#1d1d2b"/>
		<circle cx="300" cy="100" r="60" fill="#e23a78"/>
	</svg>`,
)}`;

// Node-Weekly-style FIXED-WIDTH newsletter: a `<table width="600">` whose
// `<td width="600">` carries the width — the exact markup that overflowed a
// ~390px phone (#727). The clamp CSS collapses table + cell to the frame, and
// the long unbroken URL must wrap rather than widen the page.
const NODE_WEEKLY = `${LAYOUT_CLAMP_CSS}
<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
	<tr>
		<td width="600" style="width:600px;min-width:600px;background:#83cd29;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff;">
			<h1 style="margin:0;font-size:26px;">Node Weekly</h1>
			<p style="margin:4px 0 0;font-size:14px;">Issue 540 — June 18, 2026</p>
		</td>
	</tr>
	<tr>
		<td width="600" style="width:600px;padding:24px;font-family:Georgia,serif;color:#1a1a1a;">
			<h2 style="font-size:18px;color:#111;">Node.js 24 hits LTS</h2>
			<p>The release line is now Active LTS. The permission model graduated
			from experimental, and the built-in test runner picked up snapshot
			testing — all without a single dependency.</p>
			<p>https://nodejs.example/blog/release/v24.0.0-this-is-a-deliberately-very-long-unbroken-url-to-prove-wrapping</p>
			<p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
		</td>
	</tr>
</table>
`;

// Gaslicht.com-style fixed-width marketing mail: a 600px hero image edge-to-edge
// plus a pink CTA button, no author body padding. The hero must clamp to the
// frame width and the whole layout must fit a phone.
const GASLICHT = `${LAYOUT_CLAMP_CSS}
<div style="font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; width: 600px; max-width: 600px;">
	<img src="${HERO}" alt="Hero" width="600" style="display:block;width:100%;height:auto;" />
	<div style="padding: 20px;">
		<h1 style="font-size: 22px; margin: 0 0 8px;">Bespaar op je energierekening</h1>
		<p style="margin: 0 0 16px; line-height: 1.5;">Vergelijk vandaag nog alle
		energieleveranciers en stap eenvoudig over. Onze klanten besparen gemiddeld
		honderden euro's per jaar.</p>
		<a href="https://example.com" style="display:inline-block;background:#e23a78;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;">Vergelijk nu</a>
	</div>
</div>
`;

// Substack-style FLUID newsletter: a 640px max-width body that should fill the
// reading column on desktop and reflow on a phone — the framed treatment's
// `max(100%, content)` path.
const SUBSTACK = `${LAYOUT_CLAMP_CSS}
<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
	<h1 style="font-size: 24px; margin: 0 0 4px;">The Weekly Dispatch</h1>
	<p style="color: #666; margin: 0 0 24px;">June 2026</p>
	<p>This is a fluid newsletter with a 640px max-width body. On desktop it fills
	the reading column; on a phone it reflows to the viewport with no horizontal
	scroll.</p>
	<p><a href="https://example.com" style="color: #268bd2;">Read online &rarr;</a></p>
</div>
`;

// Plain personal email: weak markup, only a font color — must pick up the UI
// font-stack + theme-aware colors so it is readable in dark mode.
const PLAIN = `${LAYOUT_CLAMP_CSS}
<div style="color:#000">
	<p>Hi there,</p>
	<p>Just confirming our call for tomorrow at 10am. Let me know if that still
	works for you.</p>
	<p>Thanks,<br>Alex</p>
</div>
`;

// Mail that genuinely cannot fit: an inline `min-width` on the table outranks
// the clamp's `* { min-width: 0 }`, so 1200px of columns stay 1200px wide and
// the email's own document is what the reader scrolls to see the rest.
const WIDE_TABLE = `${LAYOUT_CLAMP_CSS}
<div style="font-family: Helvetica, Arial, sans-serif; color:#1a1a1a;">
	<h1 style="font-size:20px;margin:0 0 12px;">Q2 regional breakdown</h1>
	<table cellpadding="8" cellspacing="0" style="min-width:1200px;border-collapse:collapse;">
		<tr style="background:#efefef;">
			<th style="min-width:200px;text-align:left;">Region</th>
			<th style="min-width:200px;text-align:left;">Pipeline</th>
			<th style="min-width:200px;text-align:left;">Closed won</th>
			<th style="min-width:200px;text-align:left;">Closed lost</th>
			<th style="min-width:200px;text-align:left;">Forecast</th>
			<th style="min-width:200px;text-align:left;">Owner</th>
		</tr>
		<tr>
			<td>Benelux</td><td>&euro;1.2M</td><td>&euro;480k</td><td>&euro;120k</td><td>&euro;1.6M</td><td>Sanne de Vries</td>
		</tr>
		<tr style="background:#f8f8f8;">
			<td>DACH</td><td>&euro;2.4M</td><td>&euro;910k</td><td>&euro;300k</td><td>&euro;3.1M</td><td>Jonas Brandt</td>
		</tr>
	</table>
	<p>Full detail in the attached sheet.</p>
</div>
`;

// Mail that declares nothing: no background, no padding, no width. The frame
// supplies the ground — the reading pane's own colour — and the breathing room
// inside it, so the surface reaches both pane edges and only the text is inset.
const BARE_MAIL = `${LAYOUT_CLAMP_CSS}
<div>
	<p>Hoi allemaal,</p>
	<p>De repetitie van donderdag gaat door. We beginnen met het nieuwe stuk en
	repeteren om 20.00 uur verder aan het programma voor het najaarsconcert.</p>
	<p>Groeten,<br>Ingrid</p>
</div>
`;

// The same mail with an author `nowrap`: the clamp wraps it rather than leaving
// a paragraph that reads only by dragging the email sideways.
const NOWRAP_MAIL = `${LAYOUT_CLAMP_CSS}
<div style="white-space:nowrap">
	<p>Hoi allemaal,</p>
	<p>De repetitie van donderdag gaat door. We beginnen met het nieuwe stuk en repeteren om 20.00 uur verder aan het programma voor het najaarsconcert.</p>
	<p>Groeten,<br>Ingrid</p>
</div>
`;

// The same nowrap as Outlook and the older generators emit it: uppercase, in an
// uppercase attribute. A case-sensitive attribute-value match sails past this
// one and pins the line the lowercase twin wraps.
const SHOUTED_NOWRAP_MAIL = `${LAYOUT_CLAMP_CSS}
<div STYLE="WHITE-SPACE: NOWRAP" id="shouted">
	<p>De repetitie van donderdag gaat door. We beginnen met het nieuwe stuk en repeteren om 20.00 uur verder aan het programma voor het najaarsconcert.</p>
</div>
`;

// A code block with a nowrap span inside it. Unwrapping that span to `normal`
// collapses the runs of spaces that are the entire point of a `<pre>`, so the
// clamp has to wrap it instead of flattening it.
const PREFORMATTED_MAIL = `${LAYOUT_CLAMP_CSS}
<pre id="listing">outer    <span style="white-space:nowrap" id="inner">A    B</span></pre>
`;

// The reading pane's ground behind the frame, so a seam between the two shows.
const PANE: Decorator = (Story) => (
	<div className="overflow-x-auto bg-canvas" style={{ width: 720 }}>
		<Story />
	</div>
);

const PHONE: Decorator = (Story) => (
	<div className="overflow-x-auto" style={{ width: 390 }}>
		<Story />
	</div>
);

// A container on a fractional boundary — a flex reading pane at 720.5px, or any
// browser zoom off 100%. The DOM rounds every width measurement to a whole
// pixel, so a frame pinned to its measured content width used to overflow this
// container by a subpixel and grow a scroll track under mail that fits.
const FRACTIONAL_COLUMN: Decorator = (Story) => (
	<div
		className="overflow-x-auto"
		style={{ width: 720.5, outline: "1px dashed rgba(120,120,120,0.6)" }}
	>
		<Story />
	</div>
);

const COLUMN: Decorator = (Story) => (
	<div className="overflow-x-auto" style={{ width: 720 }}>
		<Story />
	</div>
);

// What the sanitizer reports for these fixtures. Designed mail brings its own
// ground and its own container padding, so the frame stands back on both; the
// bare note brings neither, so the frame supplies the pane's ground and the
// breathing room inside it.
const DESIGNED = { background: true, spacing: true };
const BARE = { background: false, spacing: false };

const meta: Meta<typeof IsolatedEmailFrame> = {
	title: "Components/IsolatedEmailFrame",
	component: IsolatedEmailFrame,
	parameters: { layout: "fullscreen" },
	argTypes: {
		variant: { control: "inline-radio", options: ["plain", "framed"] },
		isDark: { control: "boolean" },
	},
};
export default meta;

type Story = StoryObj<typeof IsolatedEmailFrame>;

/** #727: a 600px fixed-width Node Weekly table at a 390px phone width. The inline
 *  `min-width:600px` on the `<td>` beats the clamp so the table can't collapse;
 *  it scrolls inside the document instead, and the phone-width box around it
 *  stays put. */
export const NodeWeeklyMobile: Story = {
	args: {
		html: NODE_WEEKLY,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [PHONE],
};

/** The same Node Weekly newsletter on a desktop reading column. */
export const NodeWeeklyDesktop: Story = {
	args: {
		html: NODE_WEEKLY,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [COLUMN],
};

/** Gaslicht.com-style 600px fixed-width marketing mail at phone width: the hero
 *  image reflows to the frame and the fixed body scrolls inside the document. */
export const GaslichtMobile: Story = {
	args: {
		html: GASLICHT,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [PHONE],
};

/** Substack-style fluid newsletter on a desktop column: fills the reading
 *  width via the framed `max(100%, content)` path. */
export const SubstackDesktop: Story = {
	args: {
		html: SUBSTACK,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [COLUMN],
};

/** Substack fluid newsletter reflowed to a phone width. */
export const SubstackMobile: Story = {
	args: {
		html: SUBSTACK,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [PHONE],
};

/** Framed newsletter on the DARK reading pane: smart-inverted to charcoal with
 *  the hero re-inverted back to natural color. */
export const NewsletterDarkPane: Story = {
	args: { html: GASLICHT, variant: "framed", isDark: true, declares: DESIGNED },
	parameters: { theme: "dark" },
	decorators: [COLUMN],
};

/** Plain personal email: UI font-stack + theme-aware colors injected so the
 *  black-on-white author text stays readable in either theme. */
export const PlainEmail: Story = {
	args: { html: PLAIN, variant: "plain", isDark: false, declares: BARE },
	decorators: [COLUMN],
};

/** Plain email in dark mode: must be light text on the dark surface, never
 *  black-on-dark. */
export const PlainEmailDark: Story = {
	args: { html: PLAIN, variant: "plain", isDark: true, declares: BARE },
	parameters: { theme: "dark" },
	decorators: [COLUMN],
};

/** A short plain email in a fractional-width column: nothing overflows, so no
 *  horizontal scrollbar may appear under it. */
export const FitsFractionalColumn: Story = {
	args: { html: PLAIN, variant: "plain", isDark: false, declares: BARE },
	decorators: [FRACTIONAL_COLUMN],
};

/** A fluid newsletter filling the same fractional column: still no scrollbar. */
export const SubstackFractionalColumn: Story = {
	args: {
		html: SUBSTACK,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [FRACTIONAL_COLUMN],
};

/** A 1200px table that genuinely does not fit: it scrolls inside the document,
 *  and the column holding the frame never grows a scrollbar of its own. */
export const WideTableScrollsInPlace: Story = {
	args: {
		html: WIDE_TABLE,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [COLUMN],
};

/** The same table on a phone: the same in-document scroll, one behaviour at
 *  every width. */
export const WideTableMobile: Story = {
	args: {
		html: WIDE_TABLE,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [PHONE],
};

/** Mail that brings no ground of its own: the frame's is the pane's, so there
 *  is no seam and no inner rectangle, and the injected inset reads as margin
 *  rather than a colour change. */
export const BareMailIsOneSurfaceWithThePane: Story = {
	args: { html: BARE_MAIL, variant: "framed", isDark: false, declares: BARE },
	decorators: [PANE],
};

/** The same on the dark pane, where an app-supplied white canvas used to be
 *  inverted into a charcoal slab sitting inside the pane. */
export const BareMailIsOneSurfaceWithThePaneDark: Story = {
	args: { html: BARE_MAIL, variant: "framed", isDark: true, declares: BARE },
	parameters: { theme: "dark" },
	decorators: [PANE],
};

/** Author `nowrap` on flowing text: wrapped to the frame, never cut. */
export const NowrapTextStillWraps: Story = {
	args: { html: NOWRAP_MAIL, variant: "framed", isDark: false, declares: BARE },
	decorators: [PANE],
};

// An element of the sanitized mail, once the frame has parsed its srcDoc — the
// story's first paint does not wait for that.
const frameElement = async (canvasElement: HTMLElement, id: string) => {
	const iframe = canvasElement.querySelector("iframe");
	if (!iframe) throw new Error("no email frame in the story");
	return await waitFor(() => {
		const element = iframe.contentDocument?.getElementById(id);
		if (!element) throw new Error(`the frame has not rendered #${id} yet`);
		return element;
	});
};

const computedWhiteSpace = (element: Element): string =>
	element.ownerDocument.defaultView?.getComputedStyle(element).whiteSpace ?? "";

/** The same nowrap in the case Outlook writes it. An attribute-value match is
 *  case-sensitive by default, so this line stayed pinned while its lowercase
 *  twin wrapped. */
export const ShoutedNowrapStillWraps: Story = {
	args: {
		html: SHOUTED_NOWRAP_MAIL,
		variant: "framed",
		isDark: false,
		declares: BARE,
	},
	decorators: [PHONE],
	play: async ({ canvasElement }) => {
		const shouted = await frameElement(canvasElement, "shouted");
		await expect(computedWhiteSpace(shouted)).toBe("normal");
	},
};

/** A `<pre>` keeps its spacing. Unwrapping a nowrap span inside it to `normal`
 *  collapses the runs of spaces the block exists to preserve, so the clamp
 *  wraps it to `pre-wrap` rather than flattening it. */
export const PreformattedTextKeepsItsSpacing: Story = {
	args: {
		html: PREFORMATTED_MAIL,
		variant: "framed",
		isDark: false,
		declares: BARE,
	},
	decorators: [PANE],
	play: async ({ canvasElement }) => {
		const inner = await frameElement(canvasElement, "inner");
		const doc = inner.ownerDocument;
		await expect(computedWhiteSpace(inner)).toBe("pre-wrap");
		// Computed style is the rule; the rendered width is the spaces surviving.
		// The twin sits in the same block so it inherits the same monospace font
		// and the only difference between the two is the whitespace handling.
		const collapsed = doc.createElement("span");
		collapsed.style.whiteSpace = "normal";
		collapsed.textContent = inner.textContent;
		inner.parentElement?.appendChild(collapsed);
		await expect(inner.getBoundingClientRect().width).toBeGreaterThan(
			collapsed.getBoundingClientRect().width,
		);
	},
};

/* ------------------------------------------------------------------ */
/* Overflow belongs to the document, not to the app                   */
/* ------------------------------------------------------------------ */

// An image with a min-width of its own: the clamp's `max-width:100% !important`
// caps it, and the un-important `* { min-width: 0 }` loses to the inline style,
// so the picture stays 1400px however narrow the pane is.
const OVERSIZED_IMAGE = `${LAYOUT_CLAMP_CSS}
<div style="font-family: Helvetica, Arial, sans-serif; color:#1a1a1a;">
	<h1 style="font-size:20px;margin:0 0 12px;">Site plan, revision C</h1>
	<img src="${HERO}" alt="Site plan" width="1400" style="min-width:1400px;height:auto;" />
	<p>The lot boundary moved two metres north.</p>
</div>
`;

// A code listing the author pinned to `white-space: pre`: rewrapping it would
// change what it says, so it stays as wide as its longest line.
const PINNED_PRE = `${LAYOUT_CLAMP_CSS}
<div style="font-family: Helvetica, Arial, sans-serif; color:#1a1a1a;">
	<p>The failing command, verbatim:</p>
	<pre style="white-space:pre">rsync --archive --compress --delete --exclude node_modules --exclude .git ./packages/backend deploy@build-01.internal:/srv/releases/2026-08-11
rsync error: some files could not be transferred (code 23) at main.c(1338)</pre>
</div>
`;

// A pane with nothing to catch an overflow: no `overflow-x`, so content that
// escapes the frame shows up as a scrollbar on the pane or on the page, and the
// assertions below see it.
const BARE_PANE: Decorator = (Story) => (
	<div data-pane className="bg-canvas" style={{ width: 720 }}>
		<Story />
	</div>
);

const BARE_PHONE: Decorator = (Story) => (
	<div data-pane className="bg-canvas" style={{ width: 390 }}>
		<Story />
	</div>
);

/**
 * Content that genuinely cannot wrap scrolls where it lives — inside the
 * document — and nothing outside the frame moves sideways for it. The frame is
 * the pane's width and the pane has nothing to scroll, so there is no route for
 * the overflow to reach the page either.
 */
const assertScrollsInsideTheDocument = async (canvasElement: HTMLElement) => {
	const iframe = canvasElement.querySelector("iframe");
	if (!iframe) throw new Error("no email frame in the story");
	await waitFor(() => {
		const body = iframe.contentDocument?.body;
		if (!body) throw new Error("the frame has not parsed its document yet");
		if (body.scrollWidth <= body.clientWidth) {
			throw new Error("the document is not holding its own overflow yet");
		}
	});
	const pane = canvasElement.querySelector<HTMLElement>("[data-pane]");
	if (!pane) throw new Error("no pane in the story");
	await expect(iframe.getBoundingClientRect().width).toBeLessThanOrEqual(
		pane.clientWidth,
	);
	await expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth);
};

/** A 1200px table on a desktop reading column. */
export const WideTableScrollsInsideTheDocument: Story = {
	args: {
		html: WIDE_TABLE,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [BARE_PANE],
	play: async ({ canvasElement }) => {
		await assertScrollsInsideTheDocument(canvasElement);
	},
};

/** The same table on a phone. */
export const WideTableScrollsInsideTheDocumentOnAPhone: Story = {
	args: {
		html: WIDE_TABLE,
		variant: "framed",
		isDark: false,
		declares: DESIGNED,
	},
	decorators: [BARE_PHONE],
	play: async ({ canvasElement }) => {
		await assertScrollsInsideTheDocument(canvasElement);
	},
};

/** A 1400px image on a desktop reading column. */
export const OversizedImageScrollsInsideTheDocument: Story = {
	args: {
		html: OVERSIZED_IMAGE,
		variant: "framed",
		isDark: false,
		declares: BARE,
	},
	decorators: [BARE_PANE],
	play: async ({ canvasElement }) => {
		await assertScrollsInsideTheDocument(canvasElement);
	},
};

/** The same image on a phone. */
export const OversizedImageScrollsInsideTheDocumentOnAPhone: Story = {
	args: {
		html: OVERSIZED_IMAGE,
		variant: "framed",
		isDark: false,
		declares: BARE,
	},
	decorators: [BARE_PHONE],
	play: async ({ canvasElement }) => {
		await assertScrollsInsideTheDocument(canvasElement);
	},
};

/** A pinned code listing on a desktop reading column. */
export const PinnedPreScrollsInsideTheDocument: Story = {
	args: {
		html: PINNED_PRE,
		variant: "framed",
		isDark: false,
		declares: BARE,
	},
	decorators: [BARE_PANE],
	play: async ({ canvasElement }) => {
		await assertScrollsInsideTheDocument(canvasElement);
	},
};

/** The same listing on a phone. */
export const PinnedPreScrollsInsideTheDocumentOnAPhone: Story = {
	args: {
		html: PINNED_PRE,
		variant: "framed",
		isDark: false,
		declares: BARE,
	},
	decorators: [BARE_PHONE],
	play: async ({ canvasElement }) => {
		await assertScrollsInsideTheDocument(canvasElement);
	},
};

/* ------------------------------------------------------------------ */
/* The frame is the column, whatever the mail is                      */
/* ------------------------------------------------------------------ */

/**
 * Two columns of the same width, a two-line note in one and 1200px of table in
 * the other. Both frames are their column, exactly — the width the reader sees
 * comes from the app's layout and nothing about the mail can move it. The old
 * policy measured the content and sized the frame to it, which is what put a
 * scroll track under mail that fitted.
 */
const assertBothFramesAreTheirColumn = async (canvasElement: HTMLElement) => {
	const panes = [...canvasElement.querySelectorAll<HTMLElement>("[data-pane]")];
	await expect(panes.length).toBe(2);
	for (const pane of panes) {
		const iframe = pane.querySelector("iframe");
		if (!iframe) throw new Error("no email frame in the pane");
		await waitFor(() => {
			if (!iframe.contentDocument?.body) {
				throw new Error("the frame has not parsed its document yet");
			}
		});
		await expect(
			Math.abs(iframe.getBoundingClientRect().width - pane.clientWidth),
		).toBeLessThanOrEqual(1);
		await expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth);
	}
};

const twoColumns = (width: number) => (
	<div className="flex flex-col gap-4">
		<div data-pane className="bg-canvas" style={{ width }}>
			<IsolatedEmailFrame
				html={BARE_MAIL}
				variant="framed"
				isDark={false}
				declares={BARE}
			/>
		</div>
		<div data-pane className="bg-canvas" style={{ width }}>
			<IsolatedEmailFrame
				html={WIDE_TABLE}
				variant="framed"
				isDark={false}
				declares={DESIGNED}
			/>
		</div>
	</div>
);

/** A desktop reading column. */
export const FrameIsTheColumnWhateverTheMail: Story = {
	render: () => twoColumns(720),
	play: async ({ canvasElement }) => {
		await assertBothFramesAreTheirColumn(canvasElement);
	},
};

/** The same pair on a phone, where the table is three times the column. */
export const FrameIsTheColumnWhateverTheMailOnAPhone: Story = {
	render: () => twoColumns(390),
	play: async ({ canvasElement }) => {
		await assertBothFramesAreTheirColumn(canvasElement);
	},
};

// A pane as wide as the page, with nothing to catch an overflow: an email that
// escaped its frame has nowhere to go but the document itself, where a
// horizontal scrollbar under the whole app is what the reader would see.
const PAGE_WIDE_PANE: Decorator = (Story) => (
	<div data-pane className="w-full bg-canvas">
		<Story />
	</div>
);

/**
 * A 1400px image in a pane the width of the page. The mail scrolls where it
 * lives and the page holds still — the app never learns how wide the picture
 * was.
 */
export const OversizedImageLeavesThePageStill: Story = {
	args: {
		html: OVERSIZED_IMAGE,
		variant: "framed",
		isDark: false,
		declares: BARE,
	},
	decorators: [PAGE_WIDE_PANE],
	play: async ({ canvasElement }) => {
		const pane = canvasElement.querySelector<HTMLElement>("[data-pane]");
		if (!pane) throw new Error("no pane in the story");
		const iframe = pane.querySelector("iframe");
		if (!iframe) throw new Error("no email frame in the pane");
		await waitFor(() => {
			if (!iframe.contentDocument?.body) {
				throw new Error("the frame has not parsed its document yet");
			}
		});
		await expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth);
		const page = canvasElement.ownerDocument.documentElement;
		await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
	},
};
