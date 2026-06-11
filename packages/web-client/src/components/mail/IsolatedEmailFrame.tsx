import { useEffect, useMemo, useRef, useState } from "react";
import { generatePlainEmailBaseCSS } from "@/lib/email-plain-base";

interface IsolatedEmailFrameProps {
	html: string;
	className?: string;
	/**
	 * When true, the email has no author-specified background and is not a
	 * newsletter/marketing category. Plain emails receive the UI font-stack
	 * and theme-aware colors so they're readable in dark mode (no black text
	 * on dark chrome). Designed emails are left untouched (their own colors
	 * are preserved inside the light-mode frame).
	 */
	isPlain?: boolean;
	/**
	 * Whether the app is currently in dark mode. Only used when `isPlain`
	 * is true — changes the injected base CSS to match the current theme.
	 */
	isDark?: boolean;
}

// Cap matches the worst real-world email we've encountered (a long
// daily-digest newsletter, ~30k px). Beyond this, an internal scrollbar
// is preferable to letting a hostile sender allocate unbounded layout.
const MAX_HEIGHT_PX = 50_000;

// Same spirit as MAX_HEIGHT_PX for the horizontal axis. Fixed-width
// newsletters top out around 900px; well past that a hostile sender is
// the more likely cause, so we cap and let the frame keep an internal
// scrollbar rather than allocate unbounded width.
const MAX_WIDTH_PX = 10_000;

// Zero the user-agent default 8px body margin so content + margins don't
// push the document's scroll size past the iframe box (which would leave a
// phantom, unscrollable scrollbar). Margin-only — never touches the
// email's own colors or typography. The plain branch already zeroes this
// in its injected base CSS; this covers the framed branch.
const MARGIN_RESET_CSS = "<style>html,body{margin:0}</style>";

/**
 * Pin an iframe axis to its content's scroll size: take the larger of the
 * body and documentElement scroll sizes, round UP so a fractional content
 * size never leaves a 1px phantom overflow, and cap at `max` so a hostile
 * sender can't allocate unbounded layout. Returned value is the explicit
 * px the iframe is sized to on that axis.
 */
export const measureContentAxis = (
	bodyScroll: number,
	rootScroll: number,
	max: number,
): number => Math.min(Math.ceil(Math.max(bodyScroll, rootScroll)), max);

// sandbox flags: scripts blocked (DOMPurify already strips them; defense
// in depth), forms blocked, top navigation blocked. `allow-popups` +
// `allow-popups-to-escape-sandbox` lets `target="_blank"` links open in a
// new tab. `allow-same-origin` is required so the parent can read
// `contentDocument.body` to size the iframe to its content — safe
// without `allow-scripts` since there's no JS in the frame to exploit it.
const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export const IsolatedEmailFrame = ({
	html,
	className,
	isPlain = false,
	isDark = false,
}: IsolatedEmailFrameProps) => {
	const ref = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);
	const [width, setWidth] = useState(0);

	// Build the full srcdoc including injected CSS. Re-computed when html,
	// isPlain, or isDark changes — when dark mode is toggled the iframe
	// reloads with the correct base colors (a reload is acceptable; it's
	// instant for in-memory content).
	//
	// The layout-clamp CSS is NOT injected here: `html` is the sanitizer's
	// output, which already prefixes its own `<style>${layoutCss}</style>`
	// block (see email-sanitizer.ts). We only prepend the plain-email base
	// CSS, and only for the plain case.
	const srcDoc = useMemo(() => {
		const baseCss = isPlain ? generatePlainEmailBaseCSS(isDark) : "";
		if (baseCss) return `<style>${baseCss}</style>${html}`;
		return `${MARGIN_RESET_CSS}${html}`;
	}, [html, isPlain, isDark]);

	useEffect(() => {
		const iframe = ref.current;
		if (!iframe) return;

		const measure = () => {
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			const root = doc.documentElement;
			const nextHeight = measureContentAxis(
				doc.body.scrollHeight,
				root?.scrollHeight ?? 0,
				MAX_HEIGHT_PX,
			);
			setHeight((prev) => (prev === nextHeight ? prev : nextHeight));
			const nextWidth = measureContentAxis(
				doc.body.scrollWidth,
				root?.scrollWidth ?? 0,
				MAX_WIDTH_PX,
			);
			setWidth((prev) => (prev === nextWidth ? prev : nextWidth));
		};

		const handleLoad = () => {
			measure();
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			const observer = new ResizeObserver(measure);
			observer.observe(doc.body);
			if (doc.documentElement) observer.observe(doc.documentElement);
			iframe.dataset.observerCleanup = "1";
			(iframe as unknown as { _observer?: ResizeObserver })._observer =
				observer;
		};

		iframe.addEventListener("load", handleLoad);
		return () => {
			iframe.removeEventListener("load", handleLoad);
			const observer = (iframe as unknown as { _observer?: ResizeObserver })
				._observer;
			observer?.disconnect();
		};
	}, []);

	return (
		<iframe
			ref={ref}
			title="Email content"
			sandbox={SANDBOX}
			srcDoc={srcDoc}
			className={className}
			style={{
				// Initial width 100% so the first measurement reflects the
				// content's natural width: fluid content reports the container
				// width (pins there → stable, no horizontal overflow), only
				// genuinely fixed-width content ends up wider than the pane.
				// Once measured, pin the explicit content width so the iframe
				// is exactly as wide as its content and grows no internal
				// horizontal scrollbar — the wide email instead drives the
				// pane viewport's horizontal scroll.
				width: width === 0 ? "100%" : `${width}px`,
				border: "none",
				display: "block",
				height: height === 0 ? "1px" : `${height}px`,
				// Designed emails (framed newsletters) pin to light-mode so the
				// author's colors survive dark mode. Plain emails use "normal" so
				// the injected base CSS (which already resolves theme colors) takes
				// full effect and the system doesn't layer another color-scheme
				// adjustment on top.
				colorScheme: isPlain ? "normal" : "light",
			}}
		/>
	);
};
