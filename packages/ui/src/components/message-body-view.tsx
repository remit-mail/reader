import { type ReactNode, useMemo } from "react";
import type { CidResolver } from "../lib/cid-resolver.js";
import { cn } from "../lib/cn.js";
import {
	classifyEmailRenderTreatment,
	type EmailRenderCategory,
} from "../lib/email-render-treatment.js";
import { createEmailSanitizer } from "../lib/email-sanitizer.js";
import { IsolatedEmailFrame } from "./isolated-email-frame.js";

export type { EmailRenderCategory } from "../lib/email-render-treatment.js";

export interface MessageBodyViewProps {
	/**
	 * Rendered email HTML (the `text/html` part's body, or a locally-rendered
	 * draft). Passed RAW — this component sanitizes it before it reaches the
	 * iframe. The single source of truth for "render an email body": app
	 * `MessageBody` and the kit reading panes both compose it, so Storybook
	 * shows the same sanitized, sandboxed rendering as the live app.
	 */
	html?: string;
	/** Plain-text fallback for messages with no HTML part. */
	text?: string;
	/** App dark mode — drives the plain/framed dark canvas in the frame. */
	isDark?: boolean;
	/**
	 * Message category (personal/newsletter/marketing/…). Together with the
	 * sanitizer's author-background detection this picks the framed vs plain
	 * treatment.
	 */
	category?: EmailRenderCategory;
	/**
	 * Whether external images are allowed to load. When false the sanitizer
	 * swaps remote `<img src>` for a placeholder and stamps `data-blocked-src`;
	 * `renderBlockedNotice` is then called with the count so the caller can
	 * offer "load images".
	 */
	allowImages?: boolean;
	/** Resolve `cid:` inline-image references to fetchable URLs. */
	resolveCid?: CidResolver;
	/** Extra classes for the body wrapper. */
	className?: string;
	/**
	 * Render a notice above the body when external images were blocked. The
	 * caller owns the "load once / always trust" affordances (they touch app
	 * trust state), so this component only reports the count. Not called, or
	 * called with `0`, when nothing was blocked.
	 */
	renderBlockedNotice?: (blockedImageCount: number) => ReactNode;
}

const EmptyBody = () => (
	<p className="text-fg-muted text-sm italic">
		This message has no body content.
	</p>
);

/**
 * The message-body region of a reading pane. The sandboxed email frame — and
 * only it — leaves the message's gutter, so mail renders on its own ground with
 * its own margins and no app canvas shows down either side of it (#763).
 * Everything else in the region is app chrome (the blocked-images notice, a
 * plain-text body, an error, the attachment list) and keeps the inset the
 * header has.
 *
 * The rule lives here, next to the `message-body-frame` marker it moves, so the
 * pane and Storybook cannot drift apart on it. The negative margins mirror the
 * message block's own `px-2 lg:px-4`.
 */
export const MessageBodyRegion = ({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) => (
	<div
		className={cn(
			"[&_.message-body-frame]:-mx-2 lg:[&_.message-body-frame]:-mx-4",
			className,
		)}
	>
		{children}
	</div>
);

/**
 * Render an email body the way the app does: sanitize the raw HTML
 * (DOMPurify + privacy/XSS scrubbing), classify it as framed (designed mail —
 * author colors preserved) or plain (theme-aware base CSS), then hand the
 * sanitized HTML to the sandboxed `IsolatedEmailFrame`. Never paints raw HTML
 * into the app DOM — the only safe contract for untrusted mail.
 */
export const MessageBodyView = ({
	html,
	text,
	isDark = false,
	category,
	allowImages = false,
	resolveCid,
	className,
	renderBlockedNotice,
}: MessageBodyViewProps) => {
	const sanitized = useMemo(() => {
		// DOMPurify needs a DOM. In a no-DOM context (SSR / unit render) we
		// cannot sanitize, so we never emit the HTML — rendering unsanitized
		// mail is not an option. The browser app always has a DOM; this guard
		// only affects server / test rendering.
		if (!html || typeof document === "undefined") return null;
		const sanitize = createEmailSanitizer({
			allowExternalImages: allowImages,
			resolveCid,
		});
		return sanitize(html);
	}, [html, allowImages, resolveCid]);

	const sanitizedHtml = sanitized?.html ?? null;

	const { framed, isPlain } = classifyEmailRenderTreatment(
		category,
		sanitized?.hasAuthorBackground ?? false,
	);

	// Stable across renders: the frame rebuilds its srcDoc — and so reloads the
	// iframe — whenever this changes identity.
	const declares = useMemo(
		() => ({
			background: sanitized?.hasAuthorBackground ?? false,
			spacing: sanitized?.hasAuthorSpacing ?? false,
		}),
		[sanitized?.hasAuthorBackground, sanitized?.hasAuthorSpacing],
	);

	const blockedImageCount = useMemo(() => {
		if (!sanitizedHtml || allowImages) return 0;
		return (sanitizedHtml.match(/data-blocked-src/g) || []).length;
	}, [sanitizedHtml, allowImages]);

	if (!sanitizedHtml && !text) {
		return (
			<div className={cn("message-body", className)}>
				<EmptyBody />
			</div>
		);
	}

	return (
		<div className={cn("message-body", className)}>
			{/* The notice keeps the container's gutter: it is app chrome, not part
			    of the email, and only `message-body-frame` below leaves the
			    gutter. */}
			{blockedImageCount > 0 && (
				<div>{renderBlockedNotice?.(blockedImageCount)}</div>
			)}

			{sanitizedHtml ? (
				// Email HTML renders inside a sandboxed iframe so its own CSS and any
				// (already-DOMPurify'd) markup cannot bleed into the app chrome. The
				// frame is the width of this box and never the width of the mail —
				// content that cannot wrap scrolls inside the frame's own document —
				// and its sandbox omits `allow-scripts` so even a hypothetical
				// sanitizer escape can't execute.
				//
				// `message-body-frame` marks the box the gutter cancel moves, and it
				// carries no width of its own: a block with both a width and a margin
				// is over-constrained, and the browser resolves that by dropping the
				// right margin — which left a strip of app canvas down one side of
				// every email. The width lives on the child instead.
				<div className="message-body-frame">
					{framed ? (
						// Full-width wrapper so a fluid newsletter fills the reading
						// column. No border, padding or background — the email renders
						// flush (#727).
						<div className="w-full max-w-full">
							<IsolatedEmailFrame
								html={sanitizedHtml}
								variant="framed"
								isDark={isDark}
								declares={declares}
							/>
						</div>
					) : (
						// `lg:max-w-2xl` caps the reading column on desktop; `max-w-full`
						// keeps the box within the viewport on mobile.
						<div className="max-w-full lg:max-w-2xl">
							<IsolatedEmailFrame
								html={sanitizedHtml}
								variant={isPlain ? "plain" : "framed"}
								isDark={isDark}
								declares={declares}
							/>
						</div>
					)}
				</div>
			) : text ? (
				// Plain text is not an email document: it has no ground of its own and
				// no layout to respect, so it keeps the message's gutter rather than
				// running to the pane edge like the sandboxed frame does.
				<pre className="email-text whitespace-pre-wrap text-sm leading-relaxed">
					{text}
				</pre>
			) : (
				<EmptyBody />
			)}
		</div>
	);
};
