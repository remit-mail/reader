import { useEffect, useMemo, useState } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { useMessageBodyContent } from "@/hooks/useMessageBodyContent";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";
import {
	buildCidResolver,
	type CidResolver,
	type ColorMode,
	createEmailSanitizer,
} from "@/lib/email-sanitizer";

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
	 * Color mode for email content.
	 * - 'light': No color processing
	 * - 'dark': Adapt colors for dark backgrounds
	 * - 'auto': Use prefers-color-scheme (default)
	 */
	colorMode?: ColorMode;
	/**
	 * Whether the From-address has the `trusted` flag set. Trusted senders
	 * auto-load images and get the more permissive color/background mode.
	 * The "Load images" bar is suppressed entirely for trusted senders.
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
}

const LoadingSkeleton = () => (
	<div className="animate-pulse space-y-2" aria-label="Loading message body">
		<div className="h-4 bg-muted rounded w-full" />
		<div className="h-4 bg-muted rounded w-11/12" />
		<div className="h-4 bg-muted rounded w-3/4" />
		<div className="h-4 bg-muted rounded w-5/6" />
	</div>
);

const EmptyBody = () => (
	<p className="text-muted-foreground text-sm italic">
		This message has no body content.
	</p>
);

export const MessageBody = ({
	bodyParts,
	html,
	text,
	colorMode = "auto",
	isTrusted = false,
	messageId,
	fromAddressId,
}: MessageBodyProps) => {
	const [allowImagesOnce, setAllowImagesOnce] = useState(false);
	const allowImages = isTrusted || allowImagesOnce;
	const { pushError } = useErrorBanners();
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

	const sanitizedHtml = useMemo(() => {
		if (!renderedHtml) return null;

		// Loading remote images is the user's signal that they trust this
		// sender. Once trusted, also let the email's author-defined
		// background colors through so brand emails aren't shredded by the
		// dark-mode color overrides.
		const effectiveColorMode: ColorMode = allowImages ? "light" : colorMode;

		const sanitize = createEmailSanitizer({
			allowExternalImages: allowImages,
			allowAuthorBackgrounds: allowImages,
			colorMode: effectiveColorMode,
			resolveCid,
		});

		return sanitize(renderedHtml);
	}, [renderedHtml, allowImages, colorMode, resolveCid]);

	const blockedImageCount = useMemo(() => {
		if (!sanitizedHtml || allowImages) return 0;
		return (sanitizedHtml.match(/data-blocked-src/g) || []).length;
	}, [sanitizedHtml, allowImages]);

	if (hasParts) {
		if (isBodyLoading) {
			return (
				<div className="message-body">
					<LoadingSkeleton />
				</div>
			);
		}
		if (isBodyError) {
			return (
				<div className="message-body">
					<ErrorState
						variant="inline"
						title="Couldn't load message body"
						error={bodyError}
						onRetry={() => refetchBody()}
					/>
				</div>
			);
		}
		if (!picked) {
			return (
				<div className="message-body">
					<EmptyBody />
				</div>
			);
		}
	} else if (!html && !text) {
		return (
			<div className="message-body">
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
		<div className="message-body">
			{blockedImageCount > 0 && (
				<div className="mb-3 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
					<span className="text-muted-foreground">
						{blockedImageCount} image{blockedImageCount > 1 ? "s" : ""} blocked
						for privacy
					</span>
					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={() => setAllowImagesOnce(true)}
							className="text-primary hover:underline"
						>
							Load once
						</button>
						{canAlwaysTrust && (
							<button
								type="button"
								onClick={handleAlwaysTrust}
								disabled={isTrustPending}
								className="text-primary hover:underline disabled:opacity-50"
							>
								Always trust
							</button>
						)}
					</div>
				</div>
			)}

			{sanitizedHtml ? (
				// Safety net: `overflow-x: hidden` on the wrapper ensures that
				// even if author markup or future sanitizer changes let some
				// content escape the clamp injected by `email-sanitizer.ts`,
				// horizontal page scroll stays disabled on mobile (#374).
				// `max-width: 100%` keeps the wrapper itself inside its column.
				<div className="max-w-full overflow-x-hidden">
					<div
						className="email-content prose prose-sm max-w-none dark:prose-invert"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized by DOMPurify
						dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
					/>
				</div>
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
