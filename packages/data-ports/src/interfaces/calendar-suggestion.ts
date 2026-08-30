import type {
	CalendarSuggestionItem,
	PutCalendarSuggestionInput,
	ResultList,
} from "../types.js";

/**
 * The two fields that record what a person decided about a suggestion. They
 * move together and only through {@link ICalendarSuggestionRepository.settle},
 * so no producer write can walk an answered card back to `Pending`, and no
 * state can name a calendar object that was never written.
 *
 * `acceptedCalendarObjectId` is `""` for every outcome but `Accepted` — the
 * named absent state, never a missing attribute.
 */
export interface SettleCalendarSuggestionInput {
	state: CalendarSuggestionItem["state"];
	acceptedCalendarObjectId: string;
}

export interface ICalendarSuggestionRepository {
	/**
	 * Writes the suggestion under its derived `suggestionId`. An upsert: the
	 * producer re-reading the same message rewrites the row it already wrote.
	 *
	 * Never touches `state` or `acceptedCalendarObjectId` on a row that already
	 * exists, so a re-sync of a message whose invitation the user accepted
	 * leaves the acceptance intact. A row it creates starts `Pending`.
	 */
	put(input: PutCalendarSuggestionInput): Promise<CalendarSuggestionItem>;
	get(
		accountConfigId: string,
		suggestionId: string,
	): Promise<CalendarSuggestionItem>;
	/** Every suggestion one message produced, superseded revisions included. */
	listByMessage(
		accountConfigId: string,
		messageId: string,
	): Promise<CalendarSuggestionItem[]>;
	/**
	 * The account's suggestions in one state, newest first. Also how the
	 * producer finds the revision a new message supersedes: only a `Pending`
	 * suggestion can be superseded, so the candidate set is this one.
	 */
	listByState(
		accountConfigId: string,
		state: CalendarSuggestionItem["state"],
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<CalendarSuggestionItem>>;
	/**
	 * Records the outcome of a person's decision. Returns the settled row.
	 */
	settle(
		accountConfigId: string,
		suggestionId: string,
		input: SettleCalendarSuggestionInput,
	): Promise<CalendarSuggestionItem>;
	/**
	 * Retires a card as `Superseded`, but only while it is still `Pending`.
	 * Returns the retired row, or `null` when the card had already been
	 * answered and nothing was written.
	 *
	 * A compare-and-set rather than a plain `settle` because the producer reads
	 * the pending set and writes to it in two steps, and a person can accept a
	 * card in between. An unconditional write there would overwrite their
	 * acceptance with `Superseded` and blank `acceptedCalendarObjectId`,
	 * severing the card from the event it put in their calendar.
	 */
	supersedeIfPending(
		accountConfigId: string,
		suggestionId: string,
	): Promise<CalendarSuggestionItem | null>;
}
