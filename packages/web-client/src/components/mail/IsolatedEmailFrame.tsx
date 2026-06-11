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
		return baseCss ? `<style>${baseCss}</style>${html}` : html;
	}, [html, isPlain, isDark]);

	useEffect(() => {
		const iframe = ref.current;
		if (!iframe) return;

		const measure = () => {
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			const next = Math.min(doc.body.scrollHeight, MAX_HEIGHT_PX);
			setHeight((prev) => (prev === next ? prev : next));
		};

		const handleLoad = () => {
			measure();
			const doc = iframe.contentDocument;
			if (!doc?.body) return;
			const observer = new ResizeObserver(measure);
			observer.observe(doc.body);
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
				width: "100%",
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
