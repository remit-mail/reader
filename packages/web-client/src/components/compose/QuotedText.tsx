import DOMPurify from "dompurify";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

const QUOTE_ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"a",
	"blockquote",
	"ul",
	"ol",
	"li",
];

const QUOTE_ALLOWED_ATTR = ["href"];

const sanitizeQuoteHtml = (html: string): string => {
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS: QUOTE_ALLOWED_TAGS,
		ALLOWED_ATTR: QUOTE_ALLOWED_ATTR,
	});
};

interface QuotedTextProps {
	text: string;
	html?: string;
	senderName?: string;
	date?: string;
}

export const QuotedText = ({
	text,
	html,
	senderName,
	date,
}: QuotedTextProps) => {
	const [isExpanded, setIsExpanded] = useState(false);

	if (!text && !html) return null;

	const attribution = [senderName, date].filter(Boolean).join(" on ");

	const sanitizedHtml = useMemo(
		() => (html ? sanitizeQuoteHtml(html) : undefined),
		[html],
	);

	return (
		<div className="mt-2 px-3 pb-2">
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
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
					{sanitizedHtml ? (
						<div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
					) : (
						text.split("\n").map((line, i) => (
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
