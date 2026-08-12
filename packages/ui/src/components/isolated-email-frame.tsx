import { useEffect, useMemo, useRef, useState } from "react";
import {
	type AuthorDeclarations,
	buildEmailSrcDoc,
	type EmailFrameVariant,
} from "./email-frame-css.js";

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
	/**
	 * What the mail declares about its own presentation, from the sanitizer. A
	 * declared background renders as authored; where the mail declares none the
	 * frame's ground is the reading pane's own colour. A mail that declares no
	 * padding or margin is given breathing room inside that ground.
	 */
	declares?: AuthorDeclarations;
	className?: string;
}

// Cap matches the worst real-world email we've encountered (a long
// daily-digest newsletter, ~30k px). Beyond this, an internal scrollbar is
// preferable to letting a hostile sender allocate unbounded layout.
const MAX_HEIGHT_PX = 50_000;

// sandbox flags: scripts blocked (DOMPurify already strips them; defence in
// depth), forms blocked, top navigation blocked. `allow-popups` +
// `allow-popups-to-escape-sandbox` lets `target="_blank"` links open in a new
// tab. `allow-same-origin` is required so the parent can read
// `contentDocument.body` to give the frame its content's height — safe without
// `allow-scripts` since there is no JS in the frame to exploit it.
const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/**
 * Pin the frame's height to its content's scroll size: take the larger of the
 * body and documentElement scroll sizes, round UP so a fractional content size
 * never leaves a 1px phantom overflow, and cap at `max` so a hostile sender
 * can't allocate unbounded layout. Returned value is the explicit px the iframe
 * is sized to. A seamless inline frame has to auto-size vertically; the width is
 * the pane's and is never read off the mail.
 */
export const measureContentAxis = (
	bodyScroll: number,
	rootScroll: number,
	max: number,
): number => Math.min(Math.ceil(Math.max(bodyScroll, rootScroll)), max);

/** Named (non-character) keys worth replaying: moving around and closing. */
const FORWARDED_NAMED_KEYS = new Set([
	"Enter",
	"Escape",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
]);

/**
 * Which keystrokes leave the frame. An allowlist rather than a denylist: the
 * replayed event's target is the host window, so the app's keyboard layer sees
 * no focused control and routes everything it recognises to the message list.
 * Forwarding indiscriminately would therefore let Backspace pressed while
 * reading delete the message under the cursor, and Space select it.
 *
 * Single characters (letters, digits, punctuation) carry the app's navigation
 * and verb bindings and are safe to replay. Space is excluded: it belongs to
 * reading the email, not to selecting rows behind it.
 */
export const isForwardableKey = (key: string): boolean => {
	if (key === " ") return false;
	if (key.length === 1) return true;
	return FORWARDED_NAMED_KEYS.has(key);
};

/**
 * Keydown events raised inside an iframe never reach the embedding window, so
 * once the reader clicks into the message body every app shortcut goes dead —
 * j/k, arrows, Esc, the lot (#43). Replay the allowlisted keystrokes on the host
 * window so the app's one keyboard layer keeps hearing them. The replay is a
 * copy: the original event is untouched, so selecting and scrolling inside the
 * email still behave normally. Modifier combos stay with the frame and the
 * browser.
 */
const forwardKeyDown = (event: KeyboardEvent) => {
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	if (!isForwardableKey(event.key)) return;
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
 * Render untrusted (sanitized) email HTML in a sandboxed iframe that is exactly
 * as wide as the pane holding it and isolates the email's CSS from the app
 * chrome.
 *
 * Presentational: HTML + treatment + theme come in via props; the component owns
 * the srcDoc assembly and the height. The width is the app's layout and nothing
 * else — the frame is never widened to fit the mail, so no measurement of the
 * email can move a box the reader can see. Content that genuinely cannot wrap (a
 * fixed-width table, an oversized image, a `pre` the author pinned) scrolls
 * inside the document, where it lives; the pane and the page never learn about
 * it.
 *
 * Height is the one axis the frame reads off its content: a seamless inline
 * frame has to grow to the mail it shows or it would scroll internally against
 * the page's own scrollbar.
 */
export const IsolatedEmailFrame = ({
	html,
	variant = "framed",
	isDark = false,
	declares,
	className,
}: IsolatedEmailFrameProps) => {
	const ref = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);

	const srcDoc = useMemo(
		() => buildEmailSrcDoc(html, variant, isDark, declares),
		[html, variant, isDark, declares],
	);

	useEffect(() => {
		const iframe = ref.current;
		if (!iframe) return;

		const measure = () => {
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			const root = doc.documentElement;
			const next = measureContentAxis(
				doc.body.scrollHeight,
				root?.scrollHeight ?? 0,
				MAX_HEIGHT_PX,
			);
			setHeight((prev) => (prev === next ? prev : next));
		};

		let observer: ResizeObserver | undefined;
		let keyDoc: Document | undefined;
		const handleLoad = () => {
			measure();
			// The srcDoc is rebuilt whenever the mail, theme or treatment changes,
			// so this fires again for a new document; the observer watching the old
			// one has to go with it.
			observer?.disconnect();
			observer = undefined;
			keyDoc?.removeEventListener("keydown", forwardKeyDown);
			keyDoc?.removeEventListener("load", measure, true);
			keyDoc = undefined;
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			observer = new ResizeObserver(measure);
			observer.observe(doc.body);
			if (doc.documentElement) observer.observe(doc.documentElement);
			// A ResizeObserver watches the body's BOX, which reflows with the pane
			// but not with its own content. Content that arrives late — an image, a
			// webfont that re-flows the text taller — changes the scroll size
			// underneath a box that never moves, so without these the frame keeps a
			// height it took before the mail finished laying out and clips the
			// difference.
			doc.addEventListener("load", measure, true);
			doc.fonts?.ready.then(measure);
			doc.addEventListener("keydown", forwardKeyDown);
			keyDoc = doc;
		};

		iframe.addEventListener("load", handleLoad);
		return () => {
			iframe.removeEventListener("load", handleLoad);
			keyDoc?.removeEventListener("keydown", forwardKeyDown);
			keyDoc?.removeEventListener("load", measure, true);
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
				width: "100%",
				border: "none",
				display: "block",
				height: height === 0 ? "1px" : `${height}px`,
				// Both branches carry their own color-scheme (and, for the framed
				// dark-invert case, the darkening filter) in the injected base CSS,
				// so the iframe element stays "normal" rather than pinning a scheme
				// that would fight a dark opt-in or the invert.
				colorScheme: "normal",
			}}
		/>
	);
};
