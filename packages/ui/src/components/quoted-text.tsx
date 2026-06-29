import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export interface QuotedTextProps {
	/** Plain-text quote, used when no `html` is supplied. */
	text: string;
	/**
	 * Sanitized quoted HTML. Must already be DOMPurify'd by the caller — this
	 * component renders it via `dangerouslySetInnerHTML` and never sanitizes.
	 * Never pass raw, untrusted HTML here.
	 */
	html?: string;
	senderName?: string;
	date?: string;
}

/**
 * Collapsible quoted-message block for reply/forward compose. Renders a muted
 * attribution toggle ("<sender> on <date> wrote:") that expands to reveal the
 * quoted body. Presentational and self-contained: collapse state is internal,
 * sanitization is the caller's responsibility.
 */
export const QuotedText = ({
	text,
	html,
	senderName,
	date,
}: QuotedTextProps) => {
	const [isExpanded, setIsExpanded] = useState(false);

	if (!text && !html) return null;

	const attribution = [senderName, date].filter(Boolean).join(" on ");

	return (
		<div className="mt-2 px-3 pb-2">
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				aria-expanded={isExpanded}
				className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors"
			>
				{isExpanded ? (
					<ChevronDown className="size-3" />
				) : (
					<ChevronRight className="size-3" />
				)}
				{attribution ? `${attribution} wrote:` : "Show quoted text"}
			</button>
			{isExpanded && (
				<blockquote className="mt-2 pl-3 border-l-2 border-fg-subtle/30 text-sm text-fg-muted [&_a]:text-accent [&_a]:underline [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-fg-subtle/30">
					{html ? (
						// biome-ignore lint/security/noDangerouslySetInnerHtml: rendering sanitized HTML via email-sanitizer
						<div dangerouslySetInnerHTML={{ __html: html }} />
					) : (
						text.split("\n").map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: list is static, no stable id
							<p key={i} className="min-h-[1.2em]">
								{line}
							</p>
						))
					)}
				</blockquote>
			)}
		</div>
	);
};
