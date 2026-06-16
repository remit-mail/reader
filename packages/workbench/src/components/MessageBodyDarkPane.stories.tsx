import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Storybook-only inline mirror of the framed (designed / newsletter) email
 * path in `IsolatedEmailFrame` + `MessageBody`. The real component imports
 * `@/lib/email-plain-base`, an alias that points at web-client's src and does
 * not resolve in the workbench build — so we copy just the framed srcDoc +
 * iframe logic here. Kept deliberately small: no ResizeObserver, just a fixed
 * iframe height that's tall enough to show the body for a screenshot.
 */

// Mirror of IsolatedEmailFrame.DARK_OPT_IN_RE.
const DARK_OPT_IN_RE =
	/prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*[^;}"']*\bdark\b/i;

// Mirror of IsolatedEmailFrame.generateFramedEmailBaseCSS.
const generateFramedEmailBaseCSS = (optsIntoDark: boolean): string =>
	optsIntoDark
		? "html,body{margin:0;color-scheme:dark light}"
		: "html,body{margin:0;background-color:#ffffff;color-scheme:light}";

const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

interface FramedEmailProps {
	html: string;
}

/** The framed branch of MessageBody after the dark-pane fix: white-canvas
 *  card wrapper + an isolated iframe whose srcDoc carries the framed base CSS. */
function FramedEmail({ html }: FramedEmailProps) {
	const optsIntoDark = DARK_OPT_IN_RE.test(html);
	const baseCss = generateFramedEmailBaseCSS(optsIntoDark);
	const srcDoc = `<style>${baseCss}</style>${html}`;
	return (
		<div className="w-full rounded-sm border border-line bg-white">
			<iframe
				title="Email content"
				sandbox={SANDBOX}
				srcDoc={srcDoc}
				scrolling="no"
				style={{
					width: "100%",
					border: "none",
					display: "block",
					height: 600,
					overflow: "hidden",
					colorScheme: "normal",
				}}
			/>
		</div>
	);
}

// JavaScript-Weekly-style newsletter: dark text, a colored heading, a couple
// of paragraphs and a link — and crucially NO body background, so the canvas
// is transparent unless we paint it.
const NEWSLETTER_HTML = `
<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
	<h1 style="color: #d33682; font-size: 24px; margin: 0 0 4px;">JavaScript Weekly</h1>
	<p style="color: #555; margin: 0 0 24px;">Issue 700 — June 16, 2026</p>
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
// alone (no forced white), letting the author's dark design show through.
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
	media query, so the client keeps the author's dark canvas instead of forcing
	a white one.</p>
	<p><a href="https://example.com" style="color: #50fa7b;">Open in browser &rarr;</a></p>
</div>
`;

const meta: Meta<FramedEmailProps> = {
	title: "Components/MessageBody Dark Pane",
	component: FramedEmail,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<FramedEmailProps>;

/** Screenshot target: a dark-text-on-white newsletter on the DARK reading
 *  pane. After the fix the iframe paints a white canvas, so the body is dark
 *  text on white and readable instead of black-on-dark. */
export const NewsletterOnDarkPane: Story = {
	args: { html: NEWSLETTER_HTML },
	parameters: { theme: "dark", layout: "padded" },
};

/** Same newsletter on the LIGHT reading pane — should look identical (white
 *  card, dark text) since the canvas is forced white in both themes. */
export const NewsletterOnLightPane: Story = {
	args: { html: NEWSLETTER_HTML },
	parameters: { theme: "light", layout: "padded" },
};

/** An email that opts into dark via `color-scheme: dark` + a
 *  `prefers-color-scheme: dark` rule. The fix advertises `dark light` and does
 *  NOT force white, so the author's own dark design is preserved. */
export const DarkOptInNewsletter: Story = {
	args: { html: DARK_OPT_IN_HTML },
	parameters: { theme: "dark" },
};
