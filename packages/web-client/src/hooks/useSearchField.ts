import { useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { addressQuery, mailViewKey } from "@/lib/mail-route";
import { committedSearchQuery, searchInputForView } from "@/lib/search-view";
import { useDebouncedValue } from "./useDebouncedValue";

export interface SearchField {
	/** The live field text, which every search surface binds. */
	searchInput: string;
	/** The debounced query the search APIs run and the mirror writes. */
	committedQuery: string;
	/** The view the field is searching (`lib/mail-route.ts`). */
	viewKey: string;
	/** Every write to the field — typed, cleared, or a chip edited. */
	setSearchInput: (query: string) => void;
}

/**
 * The one search field, held by the /mail shell so it outlives every child
 * route, and the query it commits.
 *
 * Within a view the URL's `q` seeds it and is a one-directional write target:
 * the committed value drives the search APIs and each list's `useSearchMirror`
 * writes it back. Across views the URL wins again — search is a mode of the
 * view it was typed in, so leaving that view re-seeds the field from wherever
 * the reader lands (#47), empty when the sidebar dropped `q` and the carried
 * query when the scope chip sent them to the brief to search everything.
 *
 * The re-seed is adjusted during render, not in an effect: React's documented
 * "adjusting state when a prop changes" pattern, so nothing is painted carrying
 * the previous view's text. An effect would commit one frame with the stale
 * query in it, which the mirror then has to be defended against.
 *
 * Text carries the view it was typed in, rather than the field simply taking
 * whatever the last render's view key was (#808). The address moves a render
 * ahead of React — a keystroke and the view change it followed arrive in the
 * same render, and the re-seed cannot tell them apart from what it has on
 * screen. Stamping the view at the keystroke, off the address the router has
 * already committed, says which of the two came second: type into the field
 * once the address names the next mailbox and that text is the new view's, not
 * a leftover of the one being left. Without it a query typed in that window was
 * wiped in the render that followed, and since the field then held nothing the
 * mirror had nothing to write — the query never reached the URL at all.
 *
 * Which view and which query both come off the committed address, never one
 * from the address and the other from the matched route. The matches swap a
 * render behind the address, so mixing the two reads the destination's view
 * against the outgoing list's `q` and re-seeds the field with the query the
 * reader has just navigated away from — the stamp then calls that text the new
 * view's, and nothing reconsiders it (#47).
 */
export function useSearchField(): SearchField {
	const router = useRouter();
	const viewKey = useRouterState({
		select: (state) => mailViewKey(state.location.pathname),
	});
	const urlQuery = useRouterState({
		select: (state) => addressQuery(state.location.search),
	});

	const [searchInput, setInput] = useState(urlQuery);
	const debouncedSearchInput = useDebouncedValue(searchInput, 200);

	const [typedInView, setTypedInView] = useState(viewKey);
	if (typedInView !== viewKey) {
		const seeded = searchInputForView(typedInView, viewKey, urlQuery);
		setTypedInView(viewKey);
		if (seeded !== undefined) setInput(seeded);
	}

	const setSearchInput = useCallback(
		(query: string) => {
			setTypedInView(mailViewKey(router.state.location.pathname));
			setInput(query);
		},
		[router],
	);

	return {
		searchInput,
		committedQuery: committedSearchQuery(searchInput, debouncedSearchInput),
		viewKey,
		setSearchInput,
	};
}
