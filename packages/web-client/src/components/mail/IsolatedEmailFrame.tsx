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
	 * Whether the app is currently in dark mode. Used by BOTH branches:
	 * the plain branch picks theme-aware colors; the framed branch decides
	 * whether to render as-authored on white (light theme / dark opt-in) or
	 * apply a smart-invert to darken the email into the dark pane.
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
 * dark-reading strategy. Three cases, driven by app theme + the email's own
 * dark opt-in:
 *
 * - App light theme → render as authored on a white canvas (light scheme).
 *   Light-mode reading is unchanged.
 * - App dark theme + email opts into its own dark → render as authored, no
 *   forced white; advertise both schemes so the author's design shows.
 * - App dark theme, no opt-in → CSS smart-invert to DARKEN the email into the
 *   dark pane (K-9's look): soft charcoal background, light-grey text.
 *
 * Why these exact filter values:
 * - `invert(0.92)` (not 1.0) lands on soft charcoal + light-grey like K-9
 *   rather than pure black/white.
 * - The white `html` background gives the invert a light source so it darkens
 *   to charcoal.
 * - `hue-rotate(180deg)` keeps blues blue (links) instead of flipping to
 *   orange.
 * - The media-element rule re-inverts images / logos / photos / code
 *   screenshots back to their natural colors.
 *
 * No `!important` — this is a *default* canvas, not an override, so an email's
 * own background still composes. Margin reset zeroes the UA 8px body margin so
 * content + margins don't push the scroll size past the iframe box.
 */
const generateFramedEmailBaseCSS = (
	isDark: boolean,
	optsIntoDark: boolean,
): string => {
	if (!isDark)
		return "html,body{margin:0;background-color:#ffffff;color-scheme:light}";
	if (optsIntoDark) return "html,body{margin:0;color-scheme:dark light}";
	return "html{margin:0;background-color:#ffffff;filter:invert(0.92) hue-rotate(180deg)}body{margin:0}img,picture,video,svg,canvas,[style*='background-image'],[background]{filter:invert(0.92) hue-rotate(180deg)}";
};

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
	// plain-email base CSS; the framed branch prepends a theme-aware base
	// a white canvas in light mode (or when the email opts into its own
	// dark), and a smart-invert that darkens the email into the dark pane
	// otherwise.
	const srcDoc = useMemo(() => {
		if (isPlain) {
			const baseCss = generatePlainEmailBaseCSS(isDark);
			return `<style>${baseCss}</style>${html}`;
		}
		const optsIntoDark = DARK_OPT_IN_RE.test(html);
		const baseCss = generateFramedEmailBaseCSS(isDark, optsIntoDark);
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
				// Both branches carry their own color-scheme (and, for the framed
				// dark-invert case, the darkening `filter`) in the injected base
				// CSS. So the iframe element stays "normal" and lets the
				// in-document rule decide, rather than pinning a scheme here that
				// would fight a dark opt-in or the invert.
				colorScheme: "normal",
			}}
		/>
	);
};
