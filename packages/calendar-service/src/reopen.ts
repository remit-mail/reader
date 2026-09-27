import type { CalendarAnswerOvertaken as CalendarAnswerOvertakenValue } from "@remit/api-openapi-types";
import type {
	CalendarCollectionItem,
	CalendarObjectItem,
	CalendarSuggestionItem,
	CalendarUnitOfWorkRepositories,
	ICalendarSuggestionRepository,
	ICalendarUnitOfWork,
} from "@remit/data-ports";
import {
	CalendarAnswerOvertaken,
	CalendarInviteMethod,
	CalendarSuggestionState,
} from "@remit/domain-enums";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { deleteCalendarObject } from "./put.js";
import { followingUidPrefix } from "./scope.js";

export interface ReopenCalendarSuggestionInput {
	accountConfigId: string;
	suggestion: CalendarSuggestionItem;
}

const answeredStates: ReadonlySet<CalendarSuggestionItem["state"]> = new Set([
	CalendarSuggestionState.Accepted,
	CalendarSuggestionState.Tentative,
]);

type SuggestionHolders = Pick<
	ICalendarSuggestionRepository,
	"listByAcceptedCalendarObjects"
>;

const holdersByObject = async (
	calendarSuggestion: SuggestionHolders,
	accountConfigId: string,
	suggestions: CalendarSuggestionItem[],
): Promise<Map<string, CalendarSuggestionItem[]>> => {
	const objectIds = [
		...new Set(
			suggestions
				.map((suggestion) => suggestion.acceptedCalendarObjectId)
				.filter((objectId) => objectId !== ""),
		),
	];
	const byObject = new Map<string, CalendarSuggestionItem[]>();
	for (const holder of await calendarSuggestion.listByAcceptedCalendarObjects(
		accountConfigId,
		objectIds,
	)) {
		if (!answeredStates.has(holder.state)) continue;
		const held = byObject.get(holder.acceptedCalendarObjectId) ?? [];
		held.push(holder);
		byObject.set(holder.acceptedCalendarObjectId, held);
	}
	return byObject;
};

const othersIn = (
	byObject: Map<string, CalendarSuggestionItem[]>,
	suggestion: CalendarSuggestionItem,
): CalendarSuggestionItem[] =>
	(byObject.get(suggestion.acceptedCalendarObjectId) ?? []).filter(
		(other) => other.suggestionId !== suggestion.suggestionId,
	);

const overtakenOf = (
	holders: CalendarSuggestionItem[],
): CalendarAnswerOvertakenValue =>
	holders.some((other) => other.method === CalendarInviteMethod.Cancel)
		? CalendarAnswerOvertaken.Cancellation
		: CalendarAnswerOvertaken.None;

export const answersOvertakenBy = async (
	calendarSuggestion: SuggestionHolders,
	accountConfigId: string,
	suggestions: CalendarSuggestionItem[],
): Promise<
	{
		suggestion: CalendarSuggestionItem;
		answerOvertakenBy: CalendarAnswerOvertakenValue;
	}[]
> => {
	const byObject = await holdersByObject(
		calendarSuggestion,
		accountConfigId,
		suggestions,
	);
	return suggestions.map((suggestion) => ({
		suggestion,
		answerOvertakenBy: overtakenOf(othersIn(byObject, suggestion)),
	}));
};

const locateAnswered = async (
	repos: CalendarUnitOfWorkRepositories,
	collections: CalendarCollectionItem[],
	calendarObjectId: string,
): Promise<
	{ collection: CalendarCollectionItem; object: CalendarObjectItem } | undefined
> => {
	for (const collection of collections) {
		const object = await repos.calendarObject.find(
			collection.calendarId,
			calendarObjectId,
		);
		if (object !== null) return { collection, object };
	}
	return undefined;
};

const partsOf = async (
	repos: CalendarUnitOfWorkRepositories,
	suggestion: CalendarSuggestionItem,
	collection: CalendarCollectionItem,
	answered: CalendarObjectItem,
): Promise<CalendarObjectItem[]> => [
	answered,
	...(await repos.calendarObject.listByUidPrefix(
		collection.calendarId,
		followingUidPrefix(suggestion.icalUid),
	)),
];

export const reopenCalendarSuggestion = async (
	unitOfWork: ICalendarUnitOfWork,
	input: ReopenCalendarSuggestionInput,
): Promise<CalendarResult<CalendarSuggestionItem>> => {
	const { accountConfigId, suggestion } = input;
	if (suggestion.state === CalendarSuggestionState.Pending) {
		return { ok: true, value: suggestion };
	}
	if (suggestion.state === CalendarSuggestionState.Superseded) {
		return calendarFailure(
			"NotReopenable",
			"A later message replaced this invitation, so answer that one instead.",
		);
	}
	if (suggestion.method === CalendarInviteMethod.Cancel) {
		return calendarFailure(
			"NotReopenable",
			"This is a cancellation, so there is no answer to take back.",
		);
	}

	return unitOfWork.transaction(async (repos) => {
		const holders = othersIn(
			await holdersByObject(repos.calendarSuggestion, accountConfigId, [
				suggestion,
			]),
			suggestion,
		);
		if (overtakenOf(holders) === CalendarAnswerOvertaken.Cancellation) {
			return calendarFailure<CalendarSuggestionItem>(
				"AnswerOvertaken",
				"The cancellation of this event was answered into the same event, so this answer can no longer be taken back.",
			);
		}

		const located =
			suggestion.acceptedCalendarObjectId === "" || holders.length > 0
				? undefined
				: await locateAnswered(
						repos,
						await repos.calendarCollection.listByAccountConfig(accountConfigId),
						suggestion.acceptedCalendarObjectId,
					);
		if (located) {
			for (const object of await partsOf(
				repos,
				suggestion,
				located.collection,
				located.object,
			)) {
				await deleteCalendarObject(unitOfWork, {
					accountConfigId,
					calendarId: located.collection.calendarId,
					calendarObjectId: object.calendarObjectId,
				});
			}
		}

		const settled = await repos.calendarSuggestion.settle(
			accountConfigId,
			suggestion.suggestionId,
			{ state: CalendarSuggestionState.Pending, acceptedCalendarObjectId: "" },
		);
		return { ok: true, value: settled };
	});
};
