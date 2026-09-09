import type { SearchConversion } from "@remit/ui";
import { createContext, useContext } from "react";

/**
 * The active query as clauses, which is what the wizard's search entry opens on
 * (#484). One conversion, computed once in `MailListHeader`, so the reason the
 * make-this-a-filter affordance gives and the clauses the wizard seeds from
 * cannot disagree.
 *
 * Its own context rather than a field on the list header chrome (#506): the
 * conversion is derived from the query text, so it is a new object on every
 * keystroke, and carrying it on the chrome meant the chrome was too — which
 * re-rendered every row of the virtualized list for a character the list does
 * not show. The wizard is the only reader, and it is mounted once.
 *
 * Absent when no query is up.
 */
export const SearchConversionContext = createContext<
	SearchConversion | undefined
>(undefined);

export const useSearchConversion = (): SearchConversion | undefined =>
	useContext(SearchConversionContext);
