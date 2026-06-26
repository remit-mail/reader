import { useEffect, useMemo, useRef, useState } from "react";
import { buildEmailSrcDoc, type EmailFrameVariant } from "./email-frame-css.js";

export interface IsolatedEmailFrameProps {
	/**
	 * Sanitized email HTML. Must already be DOMPurify'd and carry the
	 * sanitizer's layout-clamp `<style>` block; this component only adds the
	 * colour / font / dark-mode canvas and isolates the result in a sandboxed
	 * iframe. Never pass raw, untrusted HTML here.
	 */
	html: string;
	/**
	 * Render treatment:
	 *
	 * - `"plain"` — weakly-marked / personal mail. UI sans-serif + theme-aware
	 *   colours are injected so black-text-on-dark is readable.
	 * - `"framed"` — designed mail (newsletter / marketing / author background).
	 *   The author's colours are preserved; in dark mode the email is darkened
	 *   via a smart-invert unless it opts into its own dark design.
	 */
	variant?: EmailFrameVariant;
	/**
	 * Whether the app is in dark mode. The plain branch picks theme-aware
	 * colours; the framed branch decides whether to render as-authored on white
	 * or apply the smart-invert.
	 */
	isDark?: boolean;
	className?: string;
}

// Cap matches the worst real-world email we've encountered (a long
// daily-digest newsletter, ~30k px). Beyond this, an internal scrollbar is
// preferable to letting a hostile sender allocate unbounded layout.
const MAX_HEIGHT_PX = 50_000;

// Same spirit as MAX_HEIGHT_PX for the horizontal axis. Fixed-width newsletters
// top out around 900px; well past that a hostile sender is the likely cause.
const MAX_WIDTH_PX = 10_000;

// Below this we are on a phone: the iframe is pinned to 100% of its container
// and never to its content width, so a wide fixed-layout newsletter reflows to
// the viewport (via the sanitizer's layout-clamp CSS) instead of overflowing
// the page (#727). Wider viewports keep the content-width pin so multi-column
// newsletters render at their native width.
const NARROW_QUERY = "(max-width: 640px)";

// sandbox flags: scripts blocked (DOMPurify already strips them; defence in
// depth), forms blocked, top navigation blocked. `allow-popups` +
// `allow-popups-to-escape-sandbox` lets `target="_blank"` links open in a new
// tab. `allow-same-origin` is required so the parent can read
// `contentDocument.body` to size the iframe to its content — safe without
// `allow-scripts` since there is no JS in the frame to exploit it.
const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/**
 * Pin an iframe axis to its content's scroll size: take the larger of the body
 * and documentElement scroll sizes, round UP so a fractional content size never
 * leaves a 1px phantom overflow, and cap at `max` so a hostile sender can't
 * allocate unbounded layout. Returned value is the explicit px the iframe is
 * sized to on that axis.
 */
export const measureContentAxis = (
	bodyScroll: number,
	rootScroll: number,
	max: number,
): number => Math.min(Math.ceil(Math.max(bodyScroll, rootScroll)), max);

const useMatchMedia = (query: string): boolean => {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined" || !window.matchMedia) return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mql = window.matchMedia(query);
		setMatches(mql.matches);
		const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, [query]);

	return matches;
};

/**
 * Render untrusted (sanitized) email HTML in a sandboxed iframe that fits the
 * viewport width on mobile and isolates the email's CSS from the app chrome.
 *
 * Presentational: HTML + treatment + theme come in via props; the component
 * owns the srcDoc assembly, the content-sizing, and the fit-to-viewport
 * decision in one place. The frame sizes itself to its content via a
 * ResizeObserver so it grows no internal scrollbars — vertical scrolling and
 * (on desktop) horizontal scrolling of genuinely wide email are delegated to
 * the surrounding pane.
 */
export const IsolatedEmailFrame = ({
	html,
	variant = "framed",
	isDark = false,
	className,
}: IsolatedEmailFrameProps) => {
	const ref = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);
	const [width, setWidth] = useState(0);

	const isNarrow = useMatchMedia(NARROW_QUERY);

	const srcDoc = useMemo(
		() => buildEmailSrcDoc(html, variant, isDark),
		[html, variant, isDark],
	);

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

		let observer: ResizeObserver | undefined;
		const handleLoad = () => {
			measure();
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			observer = new ResizeObserver(measure);
			observer.observe(doc.body);
			if (doc.documentElement) observer.observe(doc.documentElement);
		};

		iframe.addEventListener("load", handleLoad);
		return () => {
			iframe.removeEventListener("load", handleLoad);
			observer?.disconnect();
		};
	}, []);

	// The fit-to-viewport decision, owned in one place:
	// - Phone (`isNarrow`): always 100% of the container, never content-pinned,
	//   so a wide fixed-width newsletter reflows to the viewport instead of
	//   unlocking horizontal page scroll (#727).
	// - Plain emails: pin to measured content width once known; 100% until then.
	// - Framed emails on desktop: `max(100%, ${width}px)` so a narrow-max-width
	//   newsletter (Substack's 640px body) fills the reading column, while a
	//   genuinely wide fixed-layout email still grows past the pane and lets the
	//   pane scroll horizontally.
	const frameWidth = isNarrow
		? "100%"
		: variant === "framed" && width > 0
			? `max(100%, ${width}px)`
			: width === 0
				? "100%"
				: `${width}px`;

	return (
		<iframe
			ref={ref}
			title="Email content"
			sandbox={SANDBOX}
			srcDoc={srcDoc}
			className={className}
			scrolling="no"
			style={{
				width: frameWidth,
				border: "none",
				display: "block",
				height: height === 0 ? "1px" : `${height}px`,
				overflow: "hidden",
				// Both branches carry their own color-scheme (and, for the framed
				// dark-invert case, the darkening filter) in the injected base CSS,
				// so the iframe element stays "normal" rather than pinning a scheme
				// that would fight a dark opt-in or the invert.
				colorScheme: "normal",
			}}
		/>
	);
};
