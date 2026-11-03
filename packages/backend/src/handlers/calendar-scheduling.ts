import type {
	CalendarInviteAnswer,
	CalendarSchedulingSend,
} from "@remit/api-openapi-types";
import {
	buildSchedulingMessage,
	type CalendarPerson,
	type SchedulingMethod,
	schedulingSubject,
} from "@remit/calendar-service";
import type {
	AccountItem,
	CreateOutboxSchedulingPartInput,
	IAccountRepository,
	IAccountSettingRepository,
	IOutboxMessageRepository,
	IOutboxSchedulingPartRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import {
	AccountService,
	AccountSettingName,
	CalendarInviteMethod,
} from "@remit/domain-enums";
import type { CreateDraftInput } from "@remit/mailbox-service";

/**
 * Who gets which scheduling message after an organizer saves an event.
 *
 * Every guest still on the list gets the event as it now stands: a save is a
 * revision, and a guest who keeps the old one keeps the old time. A guest the
 * save took off the list gets a cancellation, and only them.
 */
export const planGuestFanOut = (
	previousGuests: readonly string[],
	currentGuests: readonly string[],
): { request: string[]; cancel: string[] } => {
	const current = new Set(currentGuests);
	return {
		request: [...current],
		cancel: [...new Set(previousGuests)].filter((guest) => !current.has(guest)),
	};
};

/**
 * What a delete sends. Removing the whole event cancels it for every guest.
 * Removing one occurrence or the rest of a series leaves an event behind, and
 * the guests get that event — with the EXDATE or the shortened rule — rather
 * than a cancellation of a series that still exists.
 */
export const planDeleteFanOut = (
	removedWhole: boolean,
	guests: readonly string[],
): { method: SchedulingMethod; recipients: string[] } => ({
	method: removedWhole
		? CalendarInviteMethod.Cancel
		: CalendarInviteMethod.Request,
	recipients: [...new Set(guests)],
});

/** One message to queue: about which stored resource, to whom, saying what. */
export interface SchedulingSendPlan {
	method: SchedulingMethod;
	calendarObjectId: string;
	/** The stored resource the message is built from. */
	icalData: string;
	collectionTimezone: string;
	recipient: CalendarPerson;
	/** For a REPLY: the guest answering. For the rest: the recipient. */
	attendee: CalendarPerson;
	recurrenceId: string;
	answer?: CalendarInviteAnswer;
}

export interface CalendarScheduling {
	/** The account config's accounts — the reader's own addresses among them. */
	accounts(): Promise<AccountItem[]>;
	/** The account the editor starts on, `""` when none is set. */
	defaultOrganizerAccountId(): Promise<string>;
	/** Queues one message with its scheduling part; a failed enqueue answers with the failed row. */
	queue(
		input: CreateDraftInput,
		part: CreateOutboxSchedulingPartInput,
	): Promise<OutboxMessageItem>;
	/** The scheduling messages about an event still in the outbox, with their rows. */
	pending(
		calendarObjectId: string,
	): Promise<
		{ part: { recipient: string; method: string }; row: OutboxMessageItem }[]
	>;
	now(): Date;
}

export interface CalendarSchedulingSources {
	accountConfigId: string;
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
	accountSetting: Pick<IAccountSettingRepository, "get">;
	outboxMessage: Pick<IOutboxMessageRepository, "get">;
	outboxSchedulingPart: Pick<
		IOutboxSchedulingPartRepository,
		"listByCalendarObject"
	>;
	queue: CalendarScheduling["queue"];
}

const stringSetting = (value: unknown): string => {
	if (typeof value !== "object" || value === null) return "";
	const kind = Reflect.get(value, "kind");
	const inner = Reflect.get(value, "value");
	return kind === "String" && typeof inner === "string" ? inner : "";
};

export const calendarSchedulingOf = (
	sources: CalendarSchedulingSources,
): CalendarScheduling => ({
	accounts: () =>
		sources.account.listAllByAccountConfig(sources.accountConfigId),
	defaultOrganizerAccountId: async () =>
		stringSetting(
			(
				await sources.accountSetting.get(
					sources.accountConfigId,
					AccountSettingName.DefaultInvitationSenderAccountId,
				)
			)?.value,
		),
	queue: sources.queue,
	pending: async (calendarObjectId) => {
		const parts = await sources.outboxSchedulingPart.listByCalendarObject(
			sources.accountConfigId,
			calendarObjectId,
		);
		if (parts.length === 0) return [];
		const rows = await sources.outboxMessage.get(
			sources.accountConfigId,
			parts.map((part) => part.outboxMessageId),
		);
		const byId = new Map(rows.map((row) => [row.outboxMessageId, row]));
		return parts.flatMap((part) => {
			const row = byId.get(part.outboxMessageId);
			return row ? [{ part, row }] : [];
		});
	},
	now: () => new Date(),
});

/** Whether an account can send: a scheduling message goes out as mail. */
export const sendsMail = (account: AccountItem): boolean =>
	account.syncedServices.includes(AccountService.Mail);

const describeWhen = (icalData: string): string => {
	const start = /\r?\nDTSTART[^:]*:([^\r\n]+)/.exec(icalData)?.[1] ?? "";
	return start === "" ? "" : `When: ${start}\n`;
};

/**
 * Queues every planned message, one outbox row each, from the account given.
 * The rows are the pending records; the send worker settles each one.
 */
export const queueSchedulingSends = async (
	scheduling: CalendarScheduling,
	accountConfigId: string,
	from: AccountItem,
	plans: readonly SchedulingSendPlan[],
): Promise<CalendarSchedulingSend[]> => {
	const sends: CalendarSchedulingSend[] = [];
	for (const plan of plans) {
		const message = await buildSchedulingMessage(plan.icalData, {
			method: plan.method,
			now: scheduling.now(),
			attendee: plan.attendee,
			recurrenceId: plan.recurrenceId,
			collectionTimezone: plan.collectionTimezone,
		});
		const subject = schedulingSubject(
			plan.method,
			message.summary,
			plan.answer,
		);
		const row = await scheduling.queue(
			{
				accountId: from.accountId,
				accountConfigId,
				fromAddress: from.email,
				toAddresses: [plan.recipient.email],
				subject,
				textBody: `${subject}\n${describeWhen(message.icalData)}`,
			},
			{
				calendarObjectId: plan.calendarObjectId,
				recipient: plan.recipient.email,
				method: plan.method,
				sequence: message.sequence,
				icalData: message.icalData,
			},
		);
		sends.push({
			email: plan.recipient.email,
			outboxMessageId: row.outboxMessageId,
			method: plan.method,
			status: row.status,
		});
	}
	return sends;
};
