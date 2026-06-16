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

// Detects whether a (sanitized) email opts into dark rendering — either via a
// `prefers-color-scheme: dark` media query or an explicit `color-scheme: dark`
// declaration. Whitespace inside the value is tolerated. When present we honor
// the author's intent instead of forcing white.
const DARK_OPT_IN_RE =
	/prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*[^;}"']*\bdark\b/i;

/**
 * Base CSS for the framed (designed / newsletter) branch, mirroring K-9 Mail's
 * strategy: authored HTML renders on a WHITE canvas under a light color-scheme
 * unless the email opts into dark, in which case we leave its own background
 * alone and advertise both schemes.
 *
 * No `!important` — this is a *default* canvas, not an override. An email that
 * paints its own `body` background (branded / dark designs) still wins. Without
 * it, a newsletter authored as dark-text-on-white shows that dark text against
 * the dark reading pane (the iframe canvas is transparent) and is unreadable.
 *
 * Margin reset is folded in: zero the UA 8px body margin so content + margins
 * don't push the scroll size past the iframe box.
 */
const generateFramedEmailBaseCSS = (optsIntoDark: boolean): string =>
	optsIntoDark
		? "html,body{margin:0;color-scheme:dark light}"
		: "html,body{margin:0;background-color:#ffffff;color-scheme:light}";

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
	// block (see email-sanitizer.ts). The plain branch prepends the
	// plain-email base CSS; the framed branch prepends a white-canvas base
	// (or a dark-aware one when the email opts into dark) so designed
	// newsletters don't show dark author text against the dark pane.
	const srcDoc = useMemo(() => {
		if (isPlain) {
			const baseCss = generatePlainEmailBaseCSS(isDark);
			return `<style>${baseCss}</style>${html}`;
		}
		const optsIntoDark = DARK_OPT_IN_RE.test(html);
		const baseCss = generateFramedEmailBaseCSS(optsIntoDark);
		return `<style>${baseCss}</style>${html}`;
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
			scrolling="no"
			style={{
				// Plain emails: pin to measured content width once known, start
				// at 100% so fluid content is measured at the container width.
				//
				// Framed (newsletter) emails: use `max(100%, ${width}px)` so
				// narrow-max-width newsletters (e.g. Substack's 640px body) fill
				// the reading pane rather than rendering in a narrow column. For
				// genuinely wide fixed-layout emails (900px+) the iframe still
				// grows past the pane width and lets the pane scroll horizontally.
				width:
					!isPlain && width > 0
						? `max(100%, ${width}px)`
						: width === 0
							? "100%"
							: `${width}px`,
				border: "none",
				display: "block",
				height: height === 0 ? "1px" : `${height}px`,
				overflow: "hidden",
				// Both branches carry their own `color-scheme` in the injected
				// base CSS — plain resolves theme colors; framed emails default
				// to light (white canvas) and switch to `dark light` only when the
				// email opts into dark. So the iframe element uses "normal" and
				// lets the in-document rule decide, rather than pinning a scheme
				// here that would fight a dark opt-in.
				colorScheme: "normal",
			}}
		/>
	);
};
