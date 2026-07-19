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

// Below this we are on a phone: a wide fixed-layout email that cannot reflow is
// scaled down to fit the container instead of being clipped (#727). Wider
// viewports keep the content-width pin so multi-column newsletters render at
// their native width and the pane scrolls horizontally.
const NARROW_QUERY = "(max-width: 640px)";

// Don't scale below this — a heavily fixed-width newsletter on a tiny phone
// would otherwise shrink to unreadable. At the floor we accept that the email
// is downscaled as far as we'll go and the wrapper still clips the remainder
// (text stays larger and legible, edge content is sacrificed over a 3x shrink).
const MIN_SCALE = 0.4;

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

/**
 * The fit-to-width scale for a phone: downscale-only, so content already inside
 * the container renders 1:1 and only genuinely-wider content shrinks. Floored at
 * `MIN_SCALE` so a pathologically wide email doesn't shrink to unreadable. A
 * non-positive or unknown width yields `1` (no scale) so we never divide by zero
 * or upscale before the first measurement lands.
 */
export const computeFitScale = (
	contentWidth: number,
	containerWidth: number,
): number => {
	if (contentWidth <= 0 || containerWidth <= 0) return 1;
	if (contentWidth <= containerWidth) return 1;
	return Math.max(MIN_SCALE, containerWidth / contentWidth);
};

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
 * Keydown events raised inside an iframe never reach the embedding window, so
 * once the reader clicks into the message body every app shortcut goes dead —
 * j/k, arrows, Esc, the lot (#43). Replay unmodified keystrokes on the host
 * window so the app's one keyboard layer keeps hearing them. The replay is a
 * copy: the original event is untouched, so selecting and scrolling inside the
 * email still behave normally. Modifier combos stay with the frame and the
 * browser.
 */
const forwardKeyDown = (event: KeyboardEvent) => {
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	const doc = (event.currentTarget ?? event.target) as Document | null;
	const host = doc?.defaultView?.parent;
	if (!host || host === doc?.defaultView) return;
	host.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: event.key,
			code: event.code,
			shiftKey: event.shiftKey,
			bubbles: true,
			cancelable: true,
		}),
	);
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
 *
 * On a phone a fixed-layout email that *can't* reflow (an inline
 * `min-width:600px` on a `<td>` beats the sanitizer's clamp) is rendered at its
 * natural width and the whole iframe is CSS-scaled down to fit the container —
 * the email stays whole and readable instead of being clipped (#727).
 */
export const IsolatedEmailFrame = ({
	html,
	variant = "framed",
	isDark = false,
	className,
}: IsolatedEmailFrameProps) => {
	const hostRef = useRef<HTMLDivElement>(null);
	const ref = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);
	const [width, setWidth] = useState(0);
	const [containerWidth, setContainerWidth] = useState(0);

	const isNarrow = useMatchMedia(NARROW_QUERY);

	const srcDoc = useMemo(
		() => buildEmailSrcDoc(html, variant, isDark),
		[html, variant, isDark],
	);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const measure = () =>
			setContainerWidth((prev) =>
				prev === host.clientWidth ? prev : host.clientWidth,
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(host);
		return () => observer.disconnect();
	}, []);

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
		let keyDoc: Document | undefined;
		const handleLoad = () => {
			measure();
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			observer = new ResizeObserver(measure);
			observer.observe(doc.body);
			if (doc.documentElement) observer.observe(doc.documentElement);
			doc.addEventListener("keydown", forwardKeyDown);
			keyDoc = doc;
		};

		iframe.addEventListener("load", handleLoad);
		return () => {
			iframe.removeEventListener("load", handleLoad);
			keyDoc?.removeEventListener("keydown", forwardKeyDown);
			observer?.disconnect();
		};
	}, []);

	// The fit-to-viewport decision, owned in one place:
	// - Phone (`isNarrow`): render the iframe at its natural content width and
	//   CSS-scale the whole frame down to the container, so a fixed-width
	//   newsletter that can't reflow fits the phone whole instead of being
	//   clipped (#727). Content already within the container renders 1:1.
	// - Desktop framed: `max(100%, content)` so a narrow-max-width newsletter
	//   (Substack's 640px body) fills the reading column while a genuinely wide
	//   fixed-layout email grows past the pane and lets the pane scroll.
	// - Plain / pre-measurement: pin to measured content width, 100% until known.
	const scale = isNarrow ? computeFitScale(width, containerWidth) : 1;
	const scaled = scale < 1;

	const frameWidth = scaled
		? `${width}px`
		: isNarrow
			? "100%"
			: variant === "framed" && width > 0
				? `max(100%, ${width}px)`
				: width === 0
					? "100%"
					: `${width}px`;

	const frameHeight = height === 0 ? "1px" : `${height}px`;

	const iframe = (
		<iframe
			ref={ref}
			title="Email content"
			sandbox={SANDBOX}
			srcDoc={srcDoc}
			className={scaled ? undefined : className}
			scrolling="no"
			style={{
				width: frameWidth,
				maxWidth: scaled ? "none" : undefined,
				border: "none",
				display: "block",
				height: frameHeight,
				overflow: "hidden",
				transform: scaled ? `scale(${scale})` : undefined,
				transformOrigin: scaled ? "top left" : undefined,
				// Both branches carry their own color-scheme (and, for the framed
				// dark-invert case, the darkening filter) in the injected base CSS,
				// so the iframe element stays "normal" rather than pinning a scheme
				// that would fight a dark opt-in or the invert.
				colorScheme: "normal",
			}}
		/>
	);

	// When scaled, the iframe's layout box stays its natural (un-transformed)
	// size, so it must sit in a wrapper sized to the SCALED footprint and clip
	// the overflow — otherwise the surrounding pane sees the natural width and
	// grows a scrollbar.
	return (
		<div ref={hostRef} className={scaled ? className : undefined}>
			{scaled ? (
				<div
					style={{
						width: "100%",
						height: `${Math.ceil(height * scale)}px`,
						overflow: "hidden",
					}}
				>
					{iframe}
				</div>
			) : (
				iframe
			)}
		</div>
	);
};
