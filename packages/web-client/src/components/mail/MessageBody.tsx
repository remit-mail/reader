import {
	buildCidResolver,
	type CidResolver,
	type EmailRenderCategory,
	MessageBodyView,
} from "@remit/ui";
import { useMemo, useState } from "react";
import { useIsDark } from "@/hooks/useIsDark";
import { useMessageBodyContent } from "@/hooks/useMessageBodyContent";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";
import { cn } from "@/lib/utils";
import { BlockedImagesNotice } from "./BlockedImagesNotice";
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
	// biome-ignore lint/a11y/useSemanticElements: <div> with role="status" preserves block layout; <output> is inline
	<div
		className="animate-pulse space-y-2"
		role="status"
		aria-label="Loading message body"
	>
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
	const isDark = useIsDark();
	// `useToggleTrusted` surfaces its own failure (banner + rollback) and a fatal
	// 5xx escalates globally — no consumer-side error effect needed here.
	const { toggleTrusted, isPending: isTrustPending } = useToggleTrusted({
		messageId: messageId ?? "",
	});

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

	const resolveCid: CidResolver = useMemo(
		() => buildCidResolver(bodyParts ?? []),
		[bodyParts],
	);

	const renderedHtml =
		hasParts && fetched?.kind === "html" ? fetched.body : html;
	const renderedText =
		hasParts && fetched?.kind === "text" ? fetched.body : text;

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
		if (!fromAddressId || isTrustPending) return;
		setAllowImagesOnce(true);
		toggleTrusted(fromAddressId, false);
	};

	// The sanitize → classify → sandboxed-iframe rendering lives in the kit's
	// `MessageBodyView` (the single source of truth, shared with Storybook's
	// reading panes — #940). This component keeps the data orchestration:
	// bodyParts → html/text, the allow-images-once trust state, and the
	// privacy "images blocked" bar (it touches app trust state, so it stays
	// here and is injected via `renderBlockedNotice`).
	return (
		<MessageBodyView
			className={className}
			html={renderedHtml}
			text={renderedText}
			isDark={isDark}
			category={category}
			allowImages={allowImages}
			resolveCid={resolveCid}
			renderBlockedNotice={(blockedImageCount) => (
				<BlockedImagesNotice
					blockedImageCount={blockedImageCount}
					canAlwaysTrust={canAlwaysTrust}
					isTrustPending={isTrustPending}
					onLoadOnce={() => setAllowImagesOnce(true)}
					onAlwaysTrust={handleAlwaysTrust}
				/>
			)}
		/>
	);
};
