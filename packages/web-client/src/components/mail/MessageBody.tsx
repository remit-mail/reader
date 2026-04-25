import { useMemo, useState } from "react";
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
}

export const MessageBody = ({
	html,
	text,
	colorMode = "auto",
}: MessageBodyProps) => {
	const [allowImages, setAllowImages] = useState(false);

	const sanitizedHtml = useMemo(() => {
		if (!html) return null;

		const sanitize = createEmailSanitizer({
			allowExternalImages: allowImages,
			colorMode,
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

	return (
		<div className="message-body">
			{blockedImageCount > 0 && (
				<div className="mb-3 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
					<span className="text-muted-foreground">
						{blockedImageCount} image{blockedImageCount > 1 ? "s" : ""} blocked
						for privacy
					</span>
					<button
						type="button"
						onClick={() => setAllowImages(true)}
						className="text-primary hover:underline"
					>
						Load images
					</button>
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
