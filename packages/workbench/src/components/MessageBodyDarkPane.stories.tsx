import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Storybook-only inline mirror of the framed (designed / newsletter) email
 * path in `IsolatedEmailFrame` + `MessageBody`. The real component imports
 * `@/lib/email-plain-base`, an alias that points at web-client's src and does
 * not resolve in the workbench build — so we copy just the framed srcDoc +
 * iframe logic here. Kept deliberately small: no ResizeObserver, just a fixed
 * iframe height that's tall enough to show the body for a screenshot.
 *
 * Behavior mirrored: the framed branch is theme-aware (K-9 Mail's look). In the
 * light app theme the email renders as authored on a white canvas. In the dark
 * theme it's DARKENED via CSS smart-invert — soft charcoal background, light-
 * grey text — while images and link/accent colors are re-inverted back to
 * natural. An email that opts into its own dark design is left untouched.
 */

// Mirror of IsolatedEmailFrame.DARK_OPT_IN_RE.
const DARK_OPT_IN_RE =
	/prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*[^;}"']*\bdark\b/i;

// Mirror of IsolatedEmailFrame.generateFramedEmailBaseCSS (theme-aware):
// - light theme → white canvas, no invert
// - dark theme + email opts into its own dark → render as authored
// - dark theme otherwise → smart-invert to darken into the dark pane;
//   invert(0.92) lands on charcoal/light-grey, hue-rotate(180) keeps links
//   blue, and the media-element rule re-inverts images back to natural color.
const generateFramedEmailBaseCSS = (
	isDark: boolean,
	optsIntoDark: boolean,
): string => {
	if (!isDark)
		return "html,body{margin:0;background-color:#ffffff;color-scheme:light}";
	if (optsIntoDark) return "html,body{margin:0;color-scheme:dark light}";
	return "html{margin:0;background-color:#ffffff;filter:invert(0.92) hue-rotate(180deg)}body{margin:0}img,picture,video,svg,canvas,[style*='background-image'],[background]{filter:invert(0.92) hue-rotate(180deg)}";
};

const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

interface FramedEmailProps {
	html: string;
	/** Whether the app is in dark mode — drives the smart-invert decision. */
	isDark: boolean;
}

/** The framed branch of MessageBody after the dark-pane fix: a hairline card on
 *  surface-sunken + an isolated iframe whose srcDoc carries the theme-aware
 *  framed base CSS (white canvas in light, smart-invert in dark). */
function FramedEmail({ html, isDark }: FramedEmailProps) {
	const optsIntoDark = DARK_OPT_IN_RE.test(html);
	const baseCss = generateFramedEmailBaseCSS(isDark, optsIntoDark);
	const srcDoc = `<style>${baseCss}</style>${html}`;
	return (
		<div className="w-full rounded-sm border border-line bg-surface-sunken">
			<iframe
				title="Email content"
				sandbox={SANDBOX}
				srcDoc={srcDoc}
				scrolling="no"
				style={{
					width: "100%",
					border: "none",
					display: "block",
					height: 640,
					overflow: "hidden",
					colorScheme: "normal",
				}}
			/>
		</div>
	);
}

// Light code-block / screenshot fixture: a light-grey rounded rect with a few
// colored "code line" bars. Proves images are re-inverted to natural color in
// the dark-invert path (it should still look light sitting in the dark layout).
const CODE_SCREENSHOT = `data:image/svg+xml;utf8,${encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="160" viewBox="0 0 560 160">
		<rect x="0" y="0" width="560" height="160" rx="10" fill="#f5f5f5"/>
		<rect x="24" y="28" width="320" height="14" rx="4" fill="#d33682"/>
		<rect x="24" y="58" width="200" height="14" rx="4" fill="#268bd2"/>
		<rect x="24" y="88" width="380" height="14" rx="4" fill="#859900"/>
		<rect x="24" y="118" width="160" height="14" rx="4" fill="#268bd2"/>
	</svg>`,
)}`;

// JavaScript-Weekly-style newsletter: dark text, a colored heading, a featured
// code screenshot, a couple of paragraphs and a link — and crucially NO body
// background, so the transparent canvas exercises the smart-invert path.
const NEWSLETTER_HTML = `
<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
	<h1 style="color: #d33682; font-size: 24px; margin: 0 0 4px;">JavaScript Weekly</h1>
	<p style="color: #555; margin: 0 0 24px;">Issue 700 — June 16, 2026</p>
	<img src="${CODE_SCREENSHOT}" alt="Featured code screenshot" width="560" style="display:block;max-width:100%;margin:0 0 24px;border-radius:10px;" />
	<h2 style="color: #111; font-size: 18px;">The State of ES2026</h2>
	<p>The latest TC39 proposals are landing fast. Records and Tuples have
	reached Stage 3, and the new <code>Array.fromAsync</code> helper is now
	shipping in every major engine.</p>
	<p>This week we also look at why structured clone finally made it into
	the platform, and what it means for the libraries that have shimmed it
	for years.</p>
	<p><a href="https://example.com/issue/700" style="color: #268bd2;">Read the
	full issue &rarr;</a></p>
	<p style="color: #777; font-size: 13px; margin-top: 32px;">You are receiving
	this because you subscribed at javascriptweekly.example.</p>
</div>
`;

// Opt-in dark design: declares a dark color-scheme + a prefers-color-scheme
// dark rule that paints its own near-black background. The fix must leave this
// alone (no smart-invert), letting the author's dark design show through.
const DARK_OPT_IN_HTML = `
<style>
	:root { color-scheme: dark; }
	body { background: #0b0b0b; color: #eee; }
	@media (prefers-color-scheme: dark) { body { background: #0b0b0b; color: #eee; } }
</style>
<div style="font-family: -apple-system, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
	<h1 style="color: #8be9fd; font-size: 24px; margin: 0 0 16px;">Midnight Digest</h1>
	<p>This newsletter ships its own dark theme. It opts in via
	<code>color-scheme: dark</code> and a <code>prefers-color-scheme: dark</code>
	media query, so the client keeps the author's dark canvas instead of darkening
	it again.</p>
	<p><a href="https://example.com" style="color: #50fa7b;">Open in browser &rarr;</a></p>
</div>
`;

const meta: Meta<FramedEmailProps> = {
	title: "Components/MessageBody Dark Pane",
	component: FramedEmail,
	parameters: { layout: "padded" },
	argTypes: {
		isDark: { control: "boolean" },
	},
};
export default meta;

type Story = StoryObj<FramedEmailProps>;

/** Screenshot target: a dark-text-on-white newsletter on the DARK reading pane.
 *  The smart-invert darkens it to a charcoal background with light-grey body
 *  text, keeps the link blue (hue-rotate), and re-inverts the featured code
 *  screenshot back to its natural light colors. */
export const NewsletterOnDarkPane: Story = {
	args: { html: NEWSLETTER_HTML, isDark: true },
	parameters: { theme: "dark", layout: "padded" },
};

/** Same newsletter on the LIGHT reading pane: a white card with dark text and
 *  the image in natural color — no invert applied in light mode. */
export const NewsletterOnLightPane: Story = {
	args: { html: NEWSLETTER_HTML, isDark: false },
	parameters: { theme: "light", layout: "padded" },
};

/** An email that opts into dark via `color-scheme: dark` + a
 *  `prefers-color-scheme: dark` rule. The fix advertises `dark light` and does
 *  NOT smart-invert, so the author's own dark design is preserved (no
 *  double-darken). */
export const DarkOptInNewsletter: Story = {
	args: { html: DARK_OPT_IN_HTML, isDark: true },
	parameters: { theme: "dark" },
};
