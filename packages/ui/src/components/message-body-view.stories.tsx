import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { MessageBodyView } from "./message-body-view.js";

/**
 * `MessageBodyView` is the single source of truth for rendering an email body:
 * it sanitizes the raw HTML (DOMPurify + privacy/XSS scrubbing), classifies it
 * as framed (designed mail) or plain (theme-aware), and hands the result to the
 * sandboxed `IsolatedEmailFrame`. The app's `MessageBody` and the kit reading
 * panes both compose it, so Storybook renders email exactly as the app does
 * (#940) — sandbox, flush layout and #727 scale-to-fit all visible.
 *
 * Unlike the `IsolatedEmailFrame` stories, these fixtures pass RAW author HTML:
 * the component runs the real sanitizer, so the layout-clamp `<style>` and the
 * image-blocking are produced here, not hand-prepended.
 */

const NODE_WEEKLY = `
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
			<p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
		</td>
	</tr>
</table>
`;

const PLAIN = `
<div style="color:#000">
	<p>Hi there,</p>
	<p>Just confirming our call for tomorrow at 10am. Let me know if that still
	works for you.</p>
	<p>Thanks,<br>Alex</p>
</div>
`;

// Marketing mail with two remote images — with images blocked the sanitizer
// swaps them for placeholders and the privacy notice slot reports the count.
const WITH_REMOTE_IMAGES = `
<div style="font-family: Helvetica, Arial, sans-serif; background:#ffffff; color:#1a1a1a; padding:20px;">
	<img src="https://tracker.example/hero.png" alt="Hero" width="560" />
	<h1 style="font-size:22px;">Summer sale</h1>
	<p>Up to 40% off everything this weekend.</p>
	<img src="https://tracker.example/footer.png" alt="Footer" width="560" />
</div>
`;

// A short personal note: a few lines of text, nowhere near the width of the
// reading column. Nothing here can overflow, so the pane must show no
// horizontal scrollbar at any column width.
const SHORT_NOTE = `
<div>
	<p>Booked. See you at 3.</p>
</div>
`;

// Real mail that genuinely does not fit: a report table whose inline min-width
// beats the sanitizer's clamp (an inline style outranks its `* { min-width: 0 }`),
// so the table stays 1200px wide however narrow the column is.
const WIDE_TABLE = `
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
			<td>Benelux</td><td>€1.2M</td><td>€480k</td><td>€120k</td><td>€1.6M</td><td>Sanne de Vries</td>
		</tr>
		<tr style="background:#f8f8f8;">
			<td>DACH</td><td>€2.4M</td><td>€910k</td><td>€300k</td><td>€3.1M</td><td>Jonas Brandt</td>
		</tr>
		<tr>
			<td>Nordics</td><td>€780k</td><td>€260k</td><td>€90k</td><td>€1.0M</td><td>Elin Karlsson</td>
		</tr>
	</table>
	<p>Full detail in the attached sheet.</p>
</div>
`;

const COLUMN: Decorator = (Story) => (
	<div style={{ width: 720 }}>
		<Story />
	</div>
);

// A reading column on a fractional boundary — a flex pane at 720.5px, or any
// browser zoom off 100%. The DOM rounds every width measurement to a whole
// pixel, so this is where a frame pinned to its measured content width used to
// overflow its own pane by a subpixel and grow a full-width scroll track under
// mail that plainly fits. The outline marks the column edge.
const FRACTIONAL_COLUMN: Decorator = (Story) => (
	<div style={{ width: 720.5, outline: "1px dashed rgba(120,120,120,0.6)" }}>
		<Story />
	</div>
);

const PHONE: Decorator = (Story) => (
	<div style={{ width: 390 }}>
		<Story />
	</div>
);

const meta: Meta<typeof MessageBodyView> = {
	title: "Components/MessageBodyView",
	component: MessageBodyView,
	parameters: { layout: "padded" },
	argTypes: {
		isDark: { control: "boolean" },
		allowImages: { control: "boolean" },
	},
};
export default meta;

type Story = StoryObj<typeof MessageBodyView>;

/** A fixed-width newsletter rendered through the real pipeline: sanitized,
 *  classified framed, rendered in the sandboxed frame. */
export const Newsletter: Story = {
	args: { html: NODE_WEEKLY, category: "newsletter", allowImages: true },
	decorators: [COLUMN],
};

/** The same newsletter on a phone width — #727 scale-to-fit keeps it whole. */
export const NewsletterMobile: Story = {
	args: { html: NODE_WEEKLY, category: "newsletter", allowImages: true },
	decorators: [PHONE],
};

/** Newsletter on the dark reading pane: smart-inverted to charcoal. */
export const NewsletterDark: Story = {
	args: {
		html: NODE_WEEKLY,
		category: "newsletter",
		allowImages: true,
		isDark: true,
	},
	parameters: { theme: "dark" },
	decorators: [COLUMN],
};

/** Plain personal mail: UI font-stack + theme-aware colors injected. */
export const Plain: Story = {
	args: { html: PLAIN, category: "personal", allowImages: true },
	decorators: [COLUMN],
};

/** Plain mail in dark mode: light text on the dark surface, never black-on-dark. */
export const PlainDark: Story = {
	args: { html: PLAIN, category: "personal", allowImages: true, isDark: true },
	parameters: { theme: "dark" },
	decorators: [COLUMN],
};

/** Images blocked: the sanitizer swaps remote images for placeholders and the
 *  privacy notice reports the count via `renderBlockedNotice`. */
export const ImagesBlocked: Story = {
	args: {
		html: WITH_REMOTE_IMAGES,
		category: "marketing",
		allowImages: false,
		renderBlockedNotice: (count) => (
			<div className="mb-3 rounded-md bg-surface-sunken/50 px-3 py-2 text-sm text-fg-muted">
				{count} image{count > 1 ? "s" : ""} blocked for privacy
			</div>
		),
	},
	decorators: [COLUMN],
};

/** Same mail with images loaded — the remote images render and no notice shows. */
export const ImagesLoaded: Story = {
	args: { html: WITH_REMOTE_IMAGES, category: "marketing", allowImages: true },
	decorators: [COLUMN],
};

/** A two-line note in a column whose width is not a whole pixel: the body must
 *  show no horizontal scrollbar, because nothing overflows. */
export const NarrowBodyNoScrollbar: Story = {
	args: { html: SHORT_NOTE, category: "personal", allowImages: true },
	decorators: [FRACTIONAL_COLUMN],
};

/** The same for a fixed-width newsletter that fills the column exactly — it
 *  fits, so the pane stays put. */
export const NewsletterFillsColumnNoScrollbar: Story = {
	args: { html: NODE_WEEKLY, category: "newsletter", allowImages: true },
	decorators: [FRACTIONAL_COLUMN],
};

/** A 1200px table that genuinely cannot fit: it scrolls horizontally inside the
 *  body's own container, and the page behind it never moves sideways. */
export const WideTableScrollsInPlace: Story = {
	args: { html: WIDE_TABLE, category: "newsletter", allowImages: true },
	decorators: [COLUMN],
};

/** The same wide table on a phone: #727 scales it down to fit whole instead. */
export const WideTableMobile: Story = {
	args: { html: WIDE_TABLE, category: "newsletter", allowImages: true },
	decorators: [PHONE],
};

/** No body content: the empty-state fallback. */
export const Empty: Story = {
	args: { html: undefined, text: undefined },
	decorators: [COLUMN],
};
