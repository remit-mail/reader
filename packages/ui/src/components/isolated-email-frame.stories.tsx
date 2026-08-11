import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { IsolatedEmailFrame } from "./isolated-email-frame.js";

/**
 * `IsolatedEmailFrame` renders sanitized email HTML in a sandboxed iframe that
 * fits the viewport width on mobile and isolates the email's CSS from the app.
 *
 * The component receives HTML that already carries the sanitizer's layout-clamp
 * `<style>` block, so these stories prepend the same clamp CSS to each fixture
 * to reproduce the real pipeline. The fixtures are the real failing emails from
 * the #727 patch chain — fixed-width `<table width="600">` newsletters that
 * overflowed a phone — rendered at a phone width and at a desktop
 * reading-column width.
 *
 * On a phone (window ≤640px) a fixed-width email whose inline `min-width` beats
 * the clamp can't reflow; the frame renders it at its natural width and
 * CSS-scales the whole iframe down so it fits the container WHOLE rather than
 * being clipped (#727). To see the scale in this Storybook, narrow the browser
 * window to a phone width — the fit-to-width decision reads the window media
 * query, not the fixed-width decorator. The `computeFitScale` unit test pins the
 * scaling policy independently of the viewport.
 */

// Mirror of the sanitizer's `generateLayoutClampCSS` — clamps wide author
// markup (fixed-width tables/cells, oversized media) to the frame width and
// wraps long unbroken tokens. In the app this is prepended by the sanitizer;
// here we prepend it so the fixtures exercise the same reflow.
const LAYOUT_CLAMP_CSS = `<style>
html, body { margin: 0; padding: 0; max-width: 100%; }
body { overflow-wrap: anywhere; word-break: break-word; }
img, video, iframe, svg, canvas { max-width: 100% !important; height: auto; }
table { max-width: 100% !important; table-layout: auto; }
td, th { max-width: 100% !important; }
* { min-width: 0; }
pre, code { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
</style>`;

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
// the frame hands the surrounding container something real to scroll.
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
 *  the frame scales the whole email down to fit the box WHOLE, with no clipping
 *  and no horizontal page scroll. */
export const NodeWeeklyMobile: Story = {
	args: { html: NODE_WEEKLY, variant: "framed", isDark: false },
	decorators: [PHONE],
};

/** The same Node Weekly newsletter on a desktop reading column. */
export const NodeWeeklyDesktop: Story = {
	args: { html: NODE_WEEKLY, variant: "framed", isDark: false },
	decorators: [COLUMN],
};

/** Gaslicht.com-style 600px fixed-width marketing mail at phone width: the hero
 *  image and CTA scale down with the frame to fit the phone whole. */
export const GaslichtMobile: Story = {
	args: { html: GASLICHT, variant: "framed", isDark: false },
	decorators: [PHONE],
};

/** Substack-style fluid newsletter on a desktop column: fills the reading
 *  width via the framed `max(100%, content)` path. */
export const SubstackDesktop: Story = {
	args: { html: SUBSTACK, variant: "framed", isDark: false },
	decorators: [COLUMN],
};

/** Substack fluid newsletter reflowed to a phone width. */
export const SubstackMobile: Story = {
	args: { html: SUBSTACK, variant: "framed", isDark: false },
	decorators: [PHONE],
};

/** Framed newsletter on the DARK reading pane: smart-inverted to charcoal with
 *  the hero re-inverted back to natural color. */
export const NewsletterDarkPane: Story = {
	args: { html: GASLICHT, variant: "framed", isDark: true },
	parameters: { theme: "dark" },
	decorators: [COLUMN],
};

/** Plain personal email: UI font-stack + theme-aware colors injected so the
 *  black-on-white author text stays readable in either theme. */
export const PlainEmail: Story = {
	args: { html: PLAIN, variant: "plain", isDark: false },
	decorators: [COLUMN],
};

/** Plain email in dark mode: must be light text on the dark surface, never
 *  black-on-dark. */
export const PlainEmailDark: Story = {
	args: { html: PLAIN, variant: "plain", isDark: true },
	parameters: { theme: "dark" },
	decorators: [COLUMN],
};

/** A short plain email in a fractional-width column: nothing overflows, so no
 *  horizontal scrollbar may appear under it. */
export const FitsFractionalColumn: Story = {
	args: { html: PLAIN, variant: "plain", isDark: false },
	decorators: [FRACTIONAL_COLUMN],
};

/** A fluid newsletter filling the same fractional column: still no scrollbar. */
export const SubstackFractionalColumn: Story = {
	args: { html: SUBSTACK, variant: "framed", isDark: false },
	decorators: [FRACTIONAL_COLUMN],
};

/** A 1200px table that genuinely does not fit: the frame takes its content
 *  width and the column scrolls it horizontally, in place. */
export const WideTableScrollsInPlace: Story = {
	args: { html: WIDE_TABLE, variant: "framed", isDark: false },
	decorators: [COLUMN],
};

/** The same table on a phone: #727 scales it down to fit whole instead. */
export const WideTableMobile: Story = {
	args: { html: WIDE_TABLE, variant: "framed", isDark: false },
	decorators: [PHONE],
};
