import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface QuotedTextProps {
	text: string;
	senderName?: string;
	date?: string;
}

const prefixLines = (text: string): string =>
	text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");

export const QuotedText = ({ text, senderName, date }: QuotedTextProps) => {
	const [isExpanded, setIsExpanded] = useState(false);

	if (!text) return null;

	const attribution = [senderName, date].filter(Boolean).join(" on ");
	const quotedContent = prefixLines(text);

	return (
		<div className="border-l-2 border-muted-foreground/30 pl-3 mt-2">
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				{isExpanded ? (
					<ChevronDown className="size-3" />
				) : (
					<ChevronRight className="size-3" />
				)}
				{attribution ? `${attribution} wrote:` : "Show quoted text"}
			</button>
			{isExpanded && (
				<pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono">
					{quotedContent}
				</pre>
			)}
		</div>
	);
};
