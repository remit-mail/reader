import type {
	CalendarCollectionItem,
	CalendarEventIndexItem,
	CalendarObjectItem,
	CalendarOccurrenceInput,
	CalendarSuggestionItem,
	CreateCalendarCollectionInput,
	ICalendarCollectionRepository,
	ICalendarEventIndexRepository,
	ICalendarObjectRepository,
	ICalendarSuggestionRepository,
	ICalendarUnitOfWork,
	PutCalendarObjectInput as PutCalendarObjectRow,
	PutCalendarSuggestionInput,
	SettleCalendarSuggestionInput,
	UpdateCalendarCollectionInput,
} from "@remit/data-ports";
import {
	deriveCalendarId,
	deriveCalendarObjectId,
	deriveCalendarSuggestionId,
	normalizeCalendarUrlSegment,
} from "@remit/data-ports/id";
import { CalendarSuggestionState } from "@remit/domain-enums";

export class MissingRow extends Error {}

/**
 * A pass-through unit of work over plain maps — the shape the port documents
 * for a backend with no cross-entity transaction. It proves the write path
 * calls what it should, in the order it should; that the three writes stand or
 * fall together is proven against a real transaction, in
 * drizzle-service's calendar-put.sqlite.test.ts.
 */
export class MemoryCalendarStore implements ICalendarUnitOfWork {
	readonly collections = new Map<string, CalendarCollectionItem>();
	readonly objects = new Map<string, CalendarObjectItem>();
	readonly occurrences = new Map<string, CalendarEventIndexItem[]>();
	readonly suggestions = new Map<string, CalendarSuggestionItem>();

	private readonly collectionRepo: ICalendarCollectionRepository = {
		create: async (input: CreateCalendarCollectionInput) => {
			const urlSegment = normalizeCalendarUrlSegment(input.urlSegment);
			const calendarId = deriveCalendarId(input.accountConfigId, urlSegment);
			const existing = this.collections.get(calendarId);
			if (existing) return existing;
			const now = Date.now();
			const collection: CalendarCollectionItem = {
				calendarId,
				accountConfigId: input.accountConfigId,
				urlSegment,
				displayName: input.displayName,
				color: input.color ?? "Cal1",
				componentSet: input.componentSet ?? "VeventOnly",
				source: input.source ?? "UserCreated",
				timezone: input.timezone ?? "",
				syncSequence: 0,
				createdAt: now,
				updatedAt: now,
			};
			this.collections.set(calendarId, collection);
			return collection;
		},
		get: async (_accountConfigId: string, calendarId: string) => {
			const collection = this.collections.get(calendarId);
			if (!collection) throw new MissingRow(calendarId);
			return collection;
		},
		update: async (
			_accountConfigId: string,
			calendarId: string,
			input: UpdateCalendarCollectionInput,
		) => {
			const collection = this.collections.get(calendarId);
			if (!collection) throw new MissingRow(calendarId);
			const updated = { ...collection, ...input };
			this.collections.set(calendarId, updated);
			return updated;
		},
		delete: async (_accountConfigId: string, calendarId: string) => {
			this.collections.delete(calendarId);
		},
		listByAccountConfig: async (accountConfigId: string) =>
			[...this.collections.values()].filter(
				(collection) => collection.accountConfigId === accountConfigId,
			),
		createExclusive: async (input: CreateCalendarCollectionInput) => {
			const calendarId = deriveCalendarId(
				input.accountConfigId,
				input.urlSegment,
			);
			if (this.collections.has(calendarId)) return null;
			return this.collectionRepo.create(input);
		},
		findByUrlSegment: async (accountConfigId: string, urlSegment: string) =>
			this.collections.get(deriveCalendarId(accountConfigId, urlSegment)) ??
			null,
		bumpSyncSequence: async (_accountConfigId: string, calendarId: string) => {
			const collection = this.collections.get(calendarId);
			if (!collection) throw new MissingRow(calendarId);
			const bumped = {
				...collection,
				syncSequence: collection.syncSequence + 1,
			};
			this.collections.set(calendarId, bumped);
			return bumped.syncSequence;
		},
	};

	private readonly objectRepo: ICalendarObjectRepository = {
		put: async (input: PutCalendarObjectRow) => {
			const calendarObjectId = deriveCalendarObjectId(
				input.calendarId,
				input.resourceName,
			);
			const now = Date.now();
			const object: CalendarObjectItem = {
				...input,
				calendarObjectId,
				createdAt: this.objects.get(calendarObjectId)?.createdAt ?? now,
				updatedAt: now,
			};
			this.objects.set(calendarObjectId, object);
			return object;
		},
		listIncompleteExpansions: async (calendarId: string, instant: string) =>
			[...this.objects.values()].filter(
				(object) =>
					object.calendarId === calendarId &&
					object.expandedThrough !== "" &&
					object.expandedThrough < instant,
			),
		find: async (_calendarId: string, calendarObjectId: string) =>
			this.objects.get(calendarObjectId) ?? null,
		get: async (_calendarId: string, calendarObjectId: string) => {
			const object = this.objects.get(calendarObjectId);
			if (!object) throw new MissingRow(calendarObjectId);
			return object;
		},
		delete: async (_calendarId: string, calendarObjectId: string) => {
			this.objects.delete(calendarObjectId);
		},
		findByResourceName: async (calendarId: string, resourceName: string) =>
			this.objects.get(deriveCalendarObjectId(calendarId, resourceName)) ??
			null,
		findByUid: async (calendarId: string, icalUid: string) =>
			[...this.objects.values()].find(
				(object) =>
					object.calendarId === calendarId && object.icalUid === icalUid,
			) ?? null,
		listByCalendar: async (calendarId: string) =>
			[...this.objects.values()].filter(
				(object) => object.calendarId === calendarId,
			),
		listChangedSince: async (calendarId: string, syncSequence: number) =>
			[...this.objects.values()]
				.filter(
					(object) =>
						object.calendarId === calendarId &&
						object.syncSequence > syncSequence,
				)
				.sort((left, right) => left.syncSequence - right.syncSequence),
	};

	private readonly eventIndexRepo: ICalendarEventIndexRepository = {
		replaceForObject: async (
			calendarId: string,
			calendarObjectId: string,
			occurrences: CalendarOccurrenceInput[],
		) => {
			const now = Date.now();
			this.occurrences.set(
				calendarObjectId,
				occurrences.map((occurrence) => ({
					...occurrence,
					calendarId,
					calendarObjectId,
					createdAt: now,
					updatedAt: now,
				})),
			);
		},
		deleteForObject: async (_calendarId: string, calendarObjectId: string) => {
			this.occurrences.delete(calendarObjectId);
		},
		listForObject: async (_calendarId: string, calendarObjectId: string) =>
			this.occurrences.get(calendarObjectId) ?? [],
		listByStartRange: async (
			calendarId: string,
			startAt: string,
			endAt: string,
		) =>
			[...this.occurrences.values()]
				.flat()
				.filter(
					(row) =>
						row.calendarId === calendarId &&
						row.startAt >= startAt &&
						row.startAt < endAt,
				)
				.sort((left, right) => left.startAt.localeCompare(right.startAt)),
	};

	private readonly suggestionRepo: ICalendarSuggestionRepository = {
		put: async (input: PutCalendarSuggestionInput) => {
			const suggestionId = deriveCalendarSuggestionId(
				input.messageId,
				input.bodyPartId,
				input.icalUid,
			);
			const now = Date.now();
			const existing = this.suggestions.get(suggestionId);
			const suggestion: CalendarSuggestionItem = {
				...input,
				suggestionId,
				state: existing?.state ?? CalendarSuggestionState.Pending,
				acceptedCalendarObjectId: existing?.acceptedCalendarObjectId ?? "",
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			};
			this.suggestions.set(suggestionId, suggestion);
			return suggestion;
		},
		get: async (accountConfigId: string, suggestionId: string) => {
			const suggestion = this.suggestions.get(suggestionId);
			if (!suggestion || suggestion.accountConfigId !== accountConfigId) {
				throw new MissingRow(suggestionId);
			}
			return suggestion;
		},
		listByMessage: async (accountConfigId: string, messageId: string) =>
			[...this.suggestions.values()].filter(
				(suggestion) =>
					suggestion.accountConfigId === accountConfigId &&
					suggestion.messageId === messageId,
			),
		listByState: async (
			accountConfigId: string,
			state: CalendarSuggestionItem["state"],
		) => ({
			items: [...this.suggestions.values()].filter(
				(suggestion) =>
					suggestion.accountConfigId === accountConfigId &&
					suggestion.state === state,
			),
			continuationToken: undefined,
		}),
		settle: async (
			accountConfigId: string,
			suggestionId: string,
			input: SettleCalendarSuggestionInput,
		) => {
			const suggestion = this.suggestions.get(suggestionId);
			if (!suggestion || suggestion.accountConfigId !== accountConfigId) {
				throw new MissingRow(suggestionId);
			}
			const settled = { ...suggestion, ...input, updatedAt: Date.now() };
			this.suggestions.set(suggestionId, settled);
			return settled;
		},
		supersedeIfPending: async (
			accountConfigId: string,
			suggestionId: string,
		) => {
			const suggestion = this.suggestions.get(suggestionId);
			if (
				!suggestion ||
				suggestion.accountConfigId !== accountConfigId ||
				suggestion.state !== CalendarSuggestionState.Pending
			) {
				return null;
			}
			const retired = {
				...suggestion,
				state: CalendarSuggestionState.Superseded,
				acceptedCalendarObjectId: "",
				updatedAt: Date.now(),
			};
			this.suggestions.set(suggestionId, retired);
			return retired;
		},
	};

	get calendarSuggestion(): ICalendarSuggestionRepository {
		return this.suggestionRepo;
	}

	transaction<T>(
		fn: (repos: {
			calendarCollection: ICalendarCollectionRepository;
			calendarObject: ICalendarObjectRepository;
			calendarEventIndex: ICalendarEventIndexRepository;
			calendarSuggestion: ICalendarSuggestionRepository;
		}) => Promise<T>,
	): Promise<T> {
		return fn({
			calendarCollection: this.collectionRepo,
			calendarObject: this.objectRepo,
			calendarEventIndex: this.eventIndexRepo,
			calendarSuggestion: this.suggestionRepo,
		});
	}
}
