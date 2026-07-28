import { Button, buildSearchRule, Dialog } from "@remit/ui";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useSearchFilterSeed } from "@/hooks/useSearchFilterSeed";
import { rulePredicate } from "@/lib/organize/rule-model";
import { convertSearchToRule } from "@/lib/organize/search-to-rule";
import type { ParsedSearchQuery } from "@/lib/search-tokens";
import { SearchFilterEditor } from "./SearchFilterEditor";

interface SearchFilterDialogProps {
	open: boolean;
	/** The account the filter is created for (an `account:` facet, else the active account). */
	accountId: string;
	/** The current search, already split into free text and facets. */
	parsed: ParsedSearchQuery;
	/**
	 * The search surfaced semantically-similar mail (a non-empty "Related"
	 * section). The literal filter cannot reproduce that reach, so the conversion
	 * states it — read from the search's own results, never probed (RFC 038 D5).
	 */
	searchHadSemanticReach: boolean;
	onClose: () => void;
}

/**
 * "Make this a filter" (RFC 038 D5). Converts the current search to clauses and
 * hands off to the shared chip editor pre-filled. No new endpoint: the seed
 * count rides `POST /organize/preview` and the commit drives the existing filter
 * CRUD.
 */
export function SearchFilterDialog({
	open,
	accountId,
	parsed,
	searchHadSemanticReach,
	onClose,
}: SearchFilterDialogProps) {
	const conversion = useMemo(
		() => convertSearchToRule(parsed, { searchHadSemanticReach }),
		[parsed, searchHadSemanticReach],
	);
	const literalPredicate = useMemo(
		() => rulePredicate(buildSearchRule(conversion)),
		[conversion],
	);

	const { seedCount, isPending, isError, retry } = useSearchFilterSeed(
		open ? accountId : undefined,
		literalPredicate,
	);
	// A search kept as a `HasWords` clause has no seed count and never will; the
	// editor opens on the uncountable reason rather than a dead end.

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
			) : isPending ? (
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
