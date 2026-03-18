import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface QuotedTextProps {
	text: string;
	senderName?: string;
	date?: string;
}

export const QuotedText = ({ text, senderName, date }: QuotedTextProps) => {
	const [isExpanded, setIsExpanded] = useState(false);

	if (!text) return null;

	const attribution = [senderName, date].filter(Boolean).join(" on ");

	return (
		<div className="mt-2 px-3 pb-2">
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
				<blockquote className="mt-2 pl-3 border-l-2 border-muted-foreground/30 text-sm text-muted-foreground">
					{text.split("\n").map((line, i) => (
						<p key={i} className="min-h-[1.2em]">
							{line}
						</p>
					))}
				</blockquote>
			)}
		</div>
	);
};
