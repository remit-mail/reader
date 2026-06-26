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
			{blockedImageCount > 0 && renderBlockedNotice?.(blockedImageCount)}

			{sanitizedHtml ? (
				// Email HTML renders inside a sandboxed iframe so its own CSS and any
				// (already-DOMPurify'd) markup cannot bleed into the app chrome. The
				// frame sizes itself to its content; its sandbox omits `allow-scripts`
				// so even a hypothetical sanitizer escape can't execute.
				framed ? (
					// Full-width wrapper so a fluid newsletter fills the reading column;
					// max-w-full + overflow-x-auto trap any residual wide content inside
					// this box rather than dragging the page on mobile. No border,
					// padding or background — the email renders flush (#727).
					<div className="w-full max-w-full overflow-x-auto">
						<IsolatedEmailFrame
							html={sanitizedHtml}
							variant="framed"
							isDark={isDark}
						/>
					</div>
				) : (
					// `lg:max-w-2xl` caps the reading column on desktop; `max-w-full`
					// keeps the box within the viewport on mobile. `overflow-x-auto`
					// traps residual wide content INSIDE this box on a phone (#727).
					<div className="max-w-full overflow-x-auto lg:max-w-2xl">
						<IsolatedEmailFrame
							html={sanitizedHtml}
							variant={isPlain ? "plain" : "framed"}
							isDark={isDark}
						/>
					</div>
				)
			) : text ? (
				<pre className="email-text whitespace-pre-wrap text-sm leading-relaxed">
					{text}
				</pre>
			) : (
				<EmptyBody />
			)}
		</div>
	);
};
