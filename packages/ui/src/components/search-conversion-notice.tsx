import { FolderInput, Info, Sparkles } from "lucide-react";
import {
	DROPPED_SEMANTIC_COPY,
	droppedFacetsCopy,
	hasConversionNotice,
	type SearchConversionNotice,
	scopedOutCopy,
} from "./search-conversion.js";

export interface SearchConversionNoticeProps {
	notice: SearchConversionNotice;
}

function NoticeRow({
	icon,
	children,
}: {
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<li className="flex items-start gap-2">
			<span className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true">
				{icon}
			</span>
			<span>{children}</span>
		</li>
	);
}

/**
 * What converting a search to a filter left behind (RFC 038 D5). Rendered above
 * the clause chips so the user sees, before touching the rule, every part of the
 * search the filter cannot carry: a folder scope, non-clause facets, and the
 * semantic reach a literal clause loses. Nothing to state renders nothing.
 * Presentational and prop-driven.
 */
export function SearchConversionNoticeView({
	notice,
}: SearchConversionNoticeProps) {
	if (!hasConversionNotice(notice)) return null;

	return (
		<div className="rounded-md border border-line bg-surface-sunken px-3 py-2.5">
			<p className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				From your search
			</p>
			<ul className="mt-1.5 space-y-1.5 text-xs text-fg-muted">
				{notice.scopedOutFolder !== undefined && (
					<NoticeRow icon={<FolderInput className="size-3.5" />}>
						{scopedOutCopy(notice.scopedOutFolder)}
					</NoticeRow>
				)}
				{notice.droppedFacets && notice.droppedFacets.length > 0 && (
					<NoticeRow icon={<Info className="size-3.5" />}>
						{droppedFacetsCopy(notice.droppedFacets)}
					</NoticeRow>
				)}
				{notice.droppedSemantic && (
					<NoticeRow icon={<Sparkles className="size-3.5" />}>
						{DROPPED_SEMANTIC_COPY}
					</NoticeRow>
				)}
			</ul>
		</div>
	);
}
