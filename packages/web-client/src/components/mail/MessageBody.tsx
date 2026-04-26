import { useEffect, useMemo, useState } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";
import { type ColorMode, createEmailSanitizer } from "@/lib/email-sanitizer";

interface MessageBodyProps {
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
	 * The current message id. Required by `useToggleTrusted` so the optimistic
	 * cache patch can target the right `describeMessage` query.
	 */
	messageId?: string;
	/**
	 * The From-address `addressId`. When omitted (e.g. the envelope has no
	 * parseable From) the "Always trust" button is hidden — same disabled-
	 * state philosophy as `MessageActionMenu`.
	 */
	fromAddressId?: string;
}

export const MessageBody = ({
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

	useEffect(() => {
		if (!trustError) return;
		pushError({
			title: "Couldn't trust sender",
			detail: formatErrorDetail(trustError),
		});
		resetTrustError();
	}, [trustError, pushError, resetTrustError]);

	const sanitizedHtml = useMemo(() => {
		if (!html) return null;

		// Loading remote images is the user's signal that they trust this
		// sender. Once trusted (per-sender flag or per-render click), also
		// let the email's author-defined background colors through (so
		// brand emails like bol.com aren't shredded by our dark-mode color
		// overrides). Until trusted we keep the conservative behaviour to
		// avoid the "disco" effect of random colored blocks on a dark theme.
		const effectiveColorMode: ColorMode = allowImages ? "light" : colorMode;

		const sanitize = createEmailSanitizer({
			allowExternalImages: allowImages,
			allowAuthorBackgrounds: allowImages,
			colorMode: effectiveColorMode,
		});

		return sanitize(html);
	}, [html, allowImages, colorMode]);

	const blockedImageCount = useMemo(() => {
		if (!sanitizedHtml || allowImages) return 0;
		return (sanitizedHtml.match(/data-blocked-src/g) || []).length;
	}, [sanitizedHtml, allowImages]);

	if (!html && !text) {
		return (
			<p className="text-muted-foreground text-sm italic">
				This message has no body content.
			</p>
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
				<div
					className="email-content prose prose-sm max-w-none dark:prose-invert"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized by DOMPurify
					dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
				/>
			) : (
				<pre className="email-text whitespace-pre-wrap text-sm leading-relaxed">
					{text}
				</pre>
			)}
		</div>
	);
};
