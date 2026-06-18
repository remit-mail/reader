import { useEffect, useMemo, useState } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { useIsDark } from "@/hooks/useIsDark";
import { useMessageBodyContent } from "@/hooks/useMessageBodyContent";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";
import {
	classifyEmailRenderTreatment,
	type EmailRenderCategory,
} from "@/lib/email-render-treatment";
import {
	buildCidResolver,
	type CidResolver,
	createEmailSanitizer,
} from "@/lib/email-sanitizer";
import { cn } from "@/lib/utils";
import { IsolatedEmailFrame } from "./IsolatedEmailFrame";
import { MessageBodyErrorBanner } from "./MessageBodyErrorBanner";

/**
 * Subset of the OpenAPI `BodyPartResponse` consumed by this component for
 * inline-image / attachment URL resolution and the body fetcher. Pinning a
 * structural subset avoids a hard import on the generated types so this file
 * compiles before `make` runs in fresh checkouts.
 */
export interface MessageBodyPart {
	bodyPartId: string;
	mediaType: string;
	mediaSubtype: string;
	contentId?: string;
	contentUrl: string;
	disposition?: string;
	dispositionFilename?: string;
	isMultipart: boolean;
}

interface MessageBodyProps {
	/**
	 * Body parts from `describeMessage`. The component picks the first
	 * `text/html` part (fallback `text/plain`) and fetches its `contentUrl`
	 * from CloudFront. `cid:CONTENT_ID` references in HTML resolve to other
	 * parts' `contentUrl` via the same list (#224 PR 3).
	 */
	bodyParts?: readonly MessageBodyPart[];
	/**
	 * Local-render fallback for callers that don't have BodyParts (Outbox
	 * drafts, Compose preview). When `bodyParts` is provided, these are
	 * ignored — the component fetches via CloudFront instead.
	 */
	html?: string;
	text?: string;
	/**
	 * Whether the From-address has the `trusted` flag set. Trusted senders
	 * auto-load images. The "Load images" bar is suppressed entirely for
	 * trusted senders.
	 */
	isTrusted?: boolean;
	/**
	 * The current message id. Required for the body-content query cache key
	 * and by `useToggleTrusted` for the optimistic cache patch.
	 */
	messageId?: string;
	/**
	 * The From-address `addressId`. When omitted (e.g. the envelope has no
	 * parseable From) the "Always trust" button is hidden.
	 */
	fromAddressId?: string;
	/**
	 * Message category (personal/newsletter/marketing/…). Together with
	 * `hasAuthorBackground` this determines whether to apply the framed
	 * newsletter treatment or the plain-email normalization CSS.
	 */
	category?: EmailRenderCategory;
	/**
	 * Extra classes for the `.message-body` wrapper. The single-message
	 * reading view (`MessageDetail`) passes `px-4` here so the body shares
	 * the header's horizontal inset (#729). `MessageCard` provides its own
	 * `px-5` inset via the surrounding card and leaves this unset.
	 */
	className?: string;
}

const LoadingSkeleton = () => (
	<div className="animate-pulse space-y-2" aria-label="Loading message body">
		<div className="h-4 bg-surface-sunken rounded w-full" />
		<div className="h-4 bg-surface-sunken rounded w-11/12" />
		<div className="h-4 bg-surface-sunken rounded w-3/4" />
		<div className="h-4 bg-surface-sunken rounded w-5/6" />
	</div>
);

const EmptyBody = () => (
	<p className="text-fg-muted text-sm italic">
		This message has no body content.
	</p>
);

export const MessageBody = ({
	bodyParts,
	html,
	text,
	isTrusted = false,
	messageId,
	fromAddressId,
	category,
	className,
}: MessageBodyProps) => {
	const [allowImagesOnce, setAllowImagesOnce] = useState(false);
	const allowImages = isTrusted || allowImagesOnce;
	const { pushError } = useErrorBanners();
	const isDark = useIsDark();
	const {
		toggleTrusted,
		isPending: isTrustPending,
		error: trustError,
		reset: resetTrustError,
	} = useToggleTrusted({ messageId: messageId ?? "" });

	const hasParts = !!bodyParts && bodyParts.length > 0;
	const {
		picked,
		data: fetched,
		isLoading: isBodyLoading,
		isError: isBodyError,
		error: bodyError,
		refetch: refetchBody,
	} = useMessageBodyContent({
		messageId,
		bodyParts,
		enabled: hasParts,
	});

	useEffect(() => {
		if (!trustError) return;
		pushError({
			title: "Couldn't trust sender",
			detail: formatErrorDetail(trustError),
		});
		resetTrustError();
	}, [trustError, pushError, resetTrustError]);

	const resolveCid: CidResolver = useMemo(
		() => buildCidResolver(bodyParts ?? []),
		[bodyParts],
	);

	const renderedHtml =
		hasParts && fetched?.kind === "html" ? fetched.body : html;
	const renderedText =
		hasParts && fetched?.kind === "text" ? fetched.body : text;

	const sanitized = useMemo(() => {
		if (!renderedHtml) return null;

		const sanitize = createEmailSanitizer({
			allowExternalImages: allowImages,
			resolveCid,
		});

		return sanitize(renderedHtml);
	}, [renderedHtml, allowImages, resolveCid]);

	const sanitizedHtml = sanitized?.html ?? null;

	/**
	 * Classify the email for rendering treatment:
	 *
	 * - `framed`: designed HTML mail (newsletter/marketing category OR
	 *   author-specified background). Rendered inside a left-anchored
	 *   hairline frame on `surface-sunken`. Light theme keeps the author's
	 *   own colors on a white canvas; dark theme darkens it via CSS
	 *   smart-invert (images / links preserved) unless it opts into its own
	 *   dark design.
	 *
	 * - `isPlain`: no author background, not newsletter/marketing. UI
	 *   sans-serif + theme-aware colors injected so black-text-on-dark
	 *   is fixed. `colorScheme` set to "normal" so the injected CSS drives
	 *   everything.
	 *
	 * Everything else is an in-between case; the framed treatment is the
	 * safe-to-show option and is the default when unsure.
	 */
	const { framed, isPlain } = classifyEmailRenderTreatment(
		category,
		sanitized?.hasAuthorBackground ?? false,
	);

	const blockedImageCount = useMemo(() => {
		if (!sanitizedHtml || allowImages) return 0;
		return (sanitizedHtml.match(/data-blocked-src/g) || []).length;
	}, [sanitizedHtml, allowImages]);

	if (hasParts) {
		if (isBodyLoading) {
			return (
				<div className={cn("message-body", className)}>
					<LoadingSkeleton />
				</div>
			);
		}
		if (isBodyError) {
			return (
				<div className={cn("message-body", className)}>
					<MessageBodyErrorBanner
						error={bodyError}
						onRetry={() => refetchBody()}
					/>
				</div>
			);
		}
		if (!picked) {
			return (
				<div className={cn("message-body", className)}>
					<EmptyBody />
				</div>
			);
		}
	} else if (!html && !text) {
		return (
			<div className={cn("message-body", className)}>
				<EmptyBody />
			</div>
		);
	}

	const canAlwaysTrust = Boolean(fromAddressId && messageId);
	const handleAlwaysTrust = () => {
		if (!fromAddressId) return;
		setAllowImagesOnce(true);
		toggleTrusted(fromAddressId, false);
	};

	return (
		<div className={cn("message-body", className)}>
			{blockedImageCount > 0 && (
				<div className="mb-3 flex items-center justify-between rounded-md bg-surface-sunken/50 px-3 py-2 text-sm">
					<span className="text-fg-muted">
						{blockedImageCount} image{blockedImageCount > 1 ? "s" : ""} blocked
						for privacy
					</span>
					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={() => setAllowImagesOnce(true)}
							className="text-accent hover:underline"
						>
							Load once
						</button>
						{canAlwaysTrust && (
							<button
								type="button"
								onClick={handleAlwaysTrust}
								disabled={isTrustPending}
								className="text-accent hover:underline disabled:opacity-50"
							>
								Always trust
							</button>
						)}
					</div>
				</div>
			)}

			{sanitizedHtml ? (
				// Email HTML renders inside a sandboxed iframe so its own CSS
				// and any (already-DOMPurify'd) markup cannot bleed into the
				// app chrome. The frame sizes itself to its content via
				// ResizeObserver; the sandbox omits `allow-scripts` so even a
				// hypothetical sanitizer escape can't execute.
				//
				// Designed / framed treatment (newsletter/marketing or author
				// background detected): hairline frame on surface-sunken. In the
				// light app theme the email renders as authored on a white canvas.
				// In the dark theme it's darkened via CSS smart-invert (images and
				// link/accent colors preserved) so it blends into the dark pane —
				// unless the email opts into its own dark design, which is left
				// untouched.
				//
				// Plain treatment (no author background, not newsletter):
				// UI sans-serif + theme-aware colors injected; colorScheme:
				// "normal" so the injected CSS drives everything.
				framed ? (
					// Full-width wrapper so a fluid/responsive newsletter
					// (Substack & co.) fills the reading column instead of
					// collapsing to its min-content width inside a `w-fit`
					// box (#541). A genuinely fixed-width email still reports a
					// wider content size and the iframe pins to it; `max-w-full`
					// + `overflow-x-auto` keep that overflow scrolling INSIDE
					// this bordered box instead of dragging the page (and the
					// app chrome) past the viewport on mobile (#727 / #528 /
					// #542). No `overflow-hidden`: clipping would hide wide
					// content instead of surfacing the in-frame scrollbar.
					<div className="w-full max-w-full overflow-x-auto rounded-sm border border-line bg-surface-sunken">
						<IsolatedEmailFrame
							html={sanitizedHtml}
							isPlain={false}
							isDark={isDark}
						/>
					</div>
				) : (
					<div className="max-w-2xl">
						<IsolatedEmailFrame
							html={sanitizedHtml}
							isPlain={isPlain}
							isDark={isDark}
						/>
					</div>
				)
			) : renderedText ? (
				<pre className="email-text whitespace-pre-wrap text-sm leading-relaxed">
					{renderedText}
				</pre>
			) : (
				<EmptyBody />
			)}
		</div>
	);
};
