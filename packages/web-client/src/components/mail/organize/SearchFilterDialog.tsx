import { Button, Dialog } from "@remit/ui";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useSearchFilterSeed } from "@/hooks/useSearchFilterSeed";
import { rulePredicate } from "@/lib/organize/rule-model";
import {
	buildSearchRule,
	convertSearchToRule,
} from "@/lib/organize/search-to-rule";
import type { ParsedSearchQuery } from "@/lib/search-tokens";
import { SearchFilterEditor } from "./SearchFilterEditor";

interface SearchFilterDialogProps {
	open: boolean;
	/** The account the filter is created for (an `account:` facet, else the active account). */
	accountId: string;
	/** The current search, already split into free text and facets. */
	parsed: ParsedSearchQuery;
	/**
	 * The search's top result — the one message on this surface with indexed
	 * vectors, used to read the deployment's semantic capability (RFC 038 D5).
	 * Absent when the search has no results to anchor the capability read on.
	 */
	probeMessageId?: string;
	onClose: () => void;
}

/**
 * "Make this a filter" (RFC 038 D5). Converts the current search to clauses,
 * reads the deployment's semantic capability from the existing Organize preview
 * signal, and hands off to the shared chip editor pre-filled. No new endpoint:
 * the seed count and the capability read both ride `POST /organize/preview`.
 */
export function SearchFilterDialog({
	open,
	accountId,
	parsed,
	probeMessageId,
	onClose,
}: SearchFilterDialogProps) {
	// The clause set does not depend on semantic capability, only the dropped-
	// semantic note does; convert once for the predicate, then fold the resolved
	// capability into the notice below.
	const base = useMemo(
		() => convertSearchToRule(parsed, { semanticAvailable: true }),
		[parsed],
	);
	const literalPredicate = useMemo(
		() => rulePredicate(buildSearchRule(base)),
		[base],
	);

	const { seedCount, semanticAvailable, isPending, isError, retry } =
		useSearchFilterSeed(
			open ? accountId : undefined,
			literalPredicate,
			base.keptTerms,
			probeMessageId,
		);

	const conversion = useMemo(
		() => ({
			...base,
			droppedSemantic: base.keptTerms && !semanticAvailable,
		}),
		[base, semanticAvailable],
	);

	if (!open) return null;

	return (
		<Dialog open={open} onClose={onClose} title="Filter rule">
			{isError ? (
				<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
					<p className="text-sm font-medium text-danger">
						Couldn't build the filter
					</p>
					<p className="max-w-xs text-xs text-fg-muted">Please try again.</p>
					<div className="mt-2 flex gap-2">
						<Button variant="primary" onClick={retry}>
							Try again
						</Button>
						<Button variant="ghost" onClick={onClose}>
							Not now
						</Button>
					</div>
				</div>
			) : isPending || seedCount === undefined ? (
				<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
					<Loader2 className="size-8 animate-spin text-accent-2" />
					<p className="text-sm font-medium text-fg">
						Turning your search into a filter…
					</p>
				</div>
			) : (
				<SearchFilterEditor
					accountId={accountId}
					conversion={conversion}
					seedCount={seedCount}
					onClose={onClose}
				/>
			)}
		</Dialog>
	);
}
