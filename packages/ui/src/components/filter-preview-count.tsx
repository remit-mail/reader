import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import { type PreviewCount, previewCountSummary } from "./filter-rule.js";

export interface FilterPreviewCountProps {
	preview: PreviewCount;
}

/**
 * The live match count (RFC 038 D1). It never goes blank between counts: a
 * clause change flips the last count to `stale` and says it is recounting
 * rather than dropping to zero and reading as "nothing matches".
 */
export function FilterPreviewCount({ preview }: FilterPreviewCountProps) {
	const summary = previewCountSummary(preview);

	if (preview.status === "loading") {
		return (
			<p
				className="flex items-center gap-2 text-xs text-fg-muted"
				aria-live="polite"
			>
				<Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
				{summary}
			</p>
		);
	}

	if (preview.status === "error") {
		return (
			<p className="flex items-center gap-2 text-xs text-danger" role="alert">
				<AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
				{summary}
			</p>
		);
	}

	const empty = preview.count === 0;
	return (
		<p
			className={cn(
				"flex items-center gap-2 text-xs",
				preview.stale
					? "text-fg-subtle"
					: empty
						? "text-fg-muted"
						: "font-medium text-fg",
			)}
			aria-live="polite"
		>
			{preview.stale && (
				<Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
			)}
			{summary}
		</p>
	);
}
