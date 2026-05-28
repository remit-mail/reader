import { useEffect, useRef, useState } from "react";

interface IsolatedEmailFrameProps {
	html: string;
	className?: string;
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
}: IsolatedEmailFrameProps) => {
	const ref = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);

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
			srcDoc={html}
			className={className}
			style={{
				width: "100%",
				border: "none",
				display: "block",
				height: height === 0 ? "1px" : `${height}px`,
				colorScheme: "light",
			}}
		/>
	);
};
