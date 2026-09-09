import type { CalendarSuggestionResponse } from "@remit/api-openapi-types";
import { acceptCalendarSuggestion } from "@remit/calendar-service";
import {
	type CalendarSuggestionItem,
	type ICalendarSuggestionRepository,
	type IEnvelopeRepository,
	type IFilterRepository,
	isSenderMuted,
} from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";
import {
	CalendarSuggestionState,
	FilterClauseField,
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient, type RemitClient } from "../service/data-client.js";
import type {
	CalendarSuggestionActionOperationIds,
	CalendarSuggestionOperationIds,
	MessageCalendarSuggestionOperationIds,
	OperationHandler,
} from "../types.js";

/**
 * The raw invitation bytes stay on the server. A client renders the projected
 * fields; the bytes exist so accepting can write them into a calendar
 * unchanged, and shipping them would invite a second, divergent renderer.
 */
export const toCalendarSuggestionResponse = (
	item: CalendarSuggestionItem,
): CalendarSuggestionResponse => {
	const { icalData: _icalData, ...response } = item;
	return response;
};

/**
 * The states a person can move a pending card into. `Superseded` is the
 * producer's alone — a revision retires a card, a person never does — and the
 * rest are terminal.
 */
export const assertSettleable = (
	suggestion: CalendarSuggestionItem,
	target: CalendarSuggestionItem["state"],
): void => {
	if (suggestion.state === CalendarSuggestionState.Pending) return;
	if (suggestion.state === target) return;
	throw new BadRequestError(
		`This suggestion was already ${suggestion.state.toLowerCase()}, so it can't be ${target.toLowerCase()}.`,
	);
};

/**
 * The mail address the card's event should name as the accepting attendee: the
 * account the invitation arrived on. Resolved from the message rather than
 * asked of the client, so an ATTENDEE line can never name an address the user
 * does not own.
 */
const accountEmailForMessage = async (
	client: RemitClient,
	messageId: string,
): Promise<string> => {
	const message = await client.message.get(messageId);
	const accountId = await client.mailbox.resolveAccountId(message.mailboxId);
	if (!accountId) {
		throw new BadRequestError(
			"The folder this invitation arrived in is gone, so there is no address to accept as.",
		);
	}
	const account = await client.account.get(accountId);
	return account.email;
};

/** What muting a sender needs, so it can be driven without a live table. */
export interface MuteSenderDeps {
	envelope: Pick<IEnvelopeRepository, "getMessageData">;
	filter: Pick<IFilterRepository, "create" | "listByAccountAndState">;
}

/**
 * The standing rule `dismiss{muteSender:true}` writes: the user saying they do
 * not want this sender's invitations offered. It goes through the existing
 * `Filter` entity rather than a second rules table, so it is visible and
 * editable beside every other rule the user has, and matches on the message's
 * From address rather than on the invitation's ORGANIZER — a `PUBLISH` names
 * no organizer at all, and the sender is who the user is refusing.
 *
 * At most one rule per sender. Dismissing the same card twice, or muting a
 * sender already muted from another card, is the same instruction repeated —
 * a second identical rule would only be a second row for the settings page to
 * show and the user to delete twice.
 */
export const muteSender = async (
	deps: MuteSenderDeps,
	accountConfigId: string,
	messageId: string,
): Promise<void> => {
	const data = await deps.envelope.getMessageData(messageId);
	const from = data.envelopeAddress.find(
		(address) => address.addressRole === "from",
	);
	if (!from) {
		throw new BadRequestError(
			"This message names no sender, so there is nobody to mute.",
		);
	}
	const active = await deps.filter.listByAccountAndState(
		accountConfigId,
		FilterState.Active,
	);
	if (isSenderMuted(active, from.normalizedEmail)) return;
	await deps.filter.create({
		accountConfigId,
		name: `Muted invitations from ${from.normalizedEmail}`,
		scope: FilterScope.Standing,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [
			{ field: FilterClauseField.From, value: from.normalizedEmail },
		],
	});
};

/**
 * Moves a card to a decision. Idempotent by design: a client that retries a
 * decline gets the same answer rather than a 400, and only a card in a
 * different terminal state is refused.
 */
export const settleSuggestion = async (
	repo: ICalendarSuggestionRepository,
	accountConfigId: string,
	suggestionId: string,
	state: CalendarSuggestionItem["state"],
): Promise<CalendarSuggestionItem> => {
	const suggestion = await repo.get(accountConfigId, suggestionId);
	assertSettleable(suggestion, state);
	if (suggestion.state === state) return suggestion;
	return repo.settle(accountConfigId, suggestionId, {
		state,
		acceptedCalendarObjectId: "",
	});
};

export const CalendarSuggestionOperations: Record<
	CalendarSuggestionOperationIds,
	OperationHandler<CalendarSuggestionOperationIds>
> = {
	CalendarSuggestionOperations_listCalendarSuggestions: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { state, continuationToken } = context.request.query as {
			state: CalendarSuggestionItem["state"];
			continuationToken?: string;
		};

		const client = await getClient();
		const page = await client.calendarSuggestion.listByState(
			accountConfigId,
			state,
			{ continuationToken },
		);

		return {
			items: page.items.map(toCalendarSuggestionResponse),
			continuationToken: page.continuationToken,
		};
	},
};

export const MessageCalendarSuggestionOperations: Record<
	MessageCalendarSuggestionOperationIds,
	OperationHandler<MessageCalendarSuggestionOperationIds>
> = {
	MessageCalendarSuggestionOperations_listMessageCalendarSuggestions: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { messageId } = context.request.params as { messageId: string };

		const client = await getClient();
		const items = await client.calendarSuggestion.listByMessage(
			accountConfigId,
			messageId,
		);

		return {
			items: items.map(toCalendarSuggestionResponse),
			continuationToken: undefined,
		};
	},
};

export const CalendarSuggestionActionOperations: Record<
	CalendarSuggestionActionOperationIds,
	OperationHandler<CalendarSuggestionActionOperationIds>
> = {
	CalendarSuggestionActionOperations_acceptCalendarSuggestion: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { suggestionId } = context.request.params as {
			suggestionId: string;
		};
		const { calendarId } = context.request.requestBody as {
			calendarId: string;
		};

		const client = await getClient();
		const suggestion = await client.calendarSuggestion.get(
			accountConfigId,
			suggestionId,
		);
		assertSettleable(suggestion, CalendarSuggestionState.Accepted);

		// Reads the collection through the caller's own account config, so a
		// calendarId naming somebody else's collection is a 404 before anything
		// is written into it.
		await client.calendarCollection.get(accountConfigId, calendarId);

		const accepted = await acceptCalendarSuggestion(client.calendarUnitOfWork, {
			accountConfigId,
			calendarId,
			suggestion,
			attendee: await accountEmailForMessage(client, suggestion.messageId),
		});
		if (!accepted.ok) {
			throw new BadRequestError(accepted.error.message);
		}

		return toCalendarSuggestionResponse(accepted.value.suggestion);
	},

	CalendarSuggestionActionOperations_declineCalendarSuggestion: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { suggestionId } = context.request.params as {
			suggestionId: string;
		};

		const client = await getClient();
		const declined = await settleSuggestion(
			client.calendarSuggestion,
			accountConfigId,
			suggestionId,
			CalendarSuggestionState.Declined,
		);

		return toCalendarSuggestionResponse(declined);
	},

	CalendarSuggestionActionOperations_dismissCalendarSuggestion: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { suggestionId } = context.request.params as {
			suggestionId: string;
		};
		const body = (context.request.requestBody ?? {}) as {
			muteSender?: boolean;
		};

		const client = await getClient();
		const dismissed = await settleSuggestion(
			client.calendarSuggestion,
			accountConfigId,
			suggestionId,
			CalendarSuggestionState.Dismissed,
		);
		if (body.muteSender) {
			await muteSender(client, accountConfigId, dismissed.messageId);
		}

		return toCalendarSuggestionResponse(dismissed);
	},
};
