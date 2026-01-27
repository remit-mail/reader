import { StarColor } from "@remit/domain-enums";
import type {
	BodyPartResponse,
	EnvelopeAddressResponse,
	EnvelopeResponse,
	MessageSummaryResponse,
} from "@remit/api-openapi-types";
import { getClient } from "../service/dynamodb.js";
import type {
	MessageBulkOperationIds,
	MessageOperationIds,
	OperationHandler,
} from "../types.js";

type StarColorValue = (typeof StarColor)[keyof typeof StarColor];

export const MessageOperations: Record<
	MessageOperationIds,
	OperationHandler<MessageOperationIds>
> = {
	MessageOperations_describeMessage: async (context) => {
		const { messageId } = context.request.params as { messageId: string };
		const description = await getClient().message.describe(messageId);

		const message = description.message[0];
		const envelope = description.envelope[0];

		const messageSummary: MessageSummaryResponse = {
			messageId: message.messageId,
			mailboxId: message.mailboxId,
			uid: message.uid,
			rfc822Size: message.rfc822Size,
			internalDate: message.internalDate,
			messageIdHeader: message.messageIdHeader,
		};

		const groupedAddresses = description.envelopeAddress.reduce(
			(acc, addr) => {
				const role = addr.addressRole;
				if (!acc[role]) acc[role] = [];
				acc[role].push({
					displayName: addr.displayName,
					normalizedEmail: addr.normalizedEmail,
					addressRole: addr.addressRole,
					addressOrder: addr.addressOrder,
				});
				return acc;
			},
			{} as Record<string, EnvelopeAddressResponse[]>,
		);

		const envelopeResponse: EnvelopeResponse = {
			messageId: envelope?.messageId ?? messageId,
			date: envelope?.dateValue ?? message.internalDate,
			subject: envelope?.subject,
			messageIdValue: envelope?.messageIdValue,
			from: groupedAddresses.from ?? [],
			to: groupedAddresses.to ?? [],
			cc: groupedAddresses.cc ?? [],
			bcc: groupedAddresses.bcc ?? [],
			replyTo: groupedAddresses.reply_to ?? [],
		};

		const bodyParts: BodyPartResponse[] = description.bodyPart.map((part) => ({
			bodyPartId: part.bodyPartId,
			mediaType: part.mediaType,
			mediaSubtype: part.mediaSubtype,
			sizeOctets: part.sizeOctets,
			disposition: part.disposition,
			dispositionFilename: part.dispositionFilename,
			isMultipart: part.isMultipart,
		}));

		const flags = description.messageFlag.map((f) => f.flagName);

		return {
			message: messageSummary,
			envelope: envelopeResponse,
			flags,
			bodyParts,
		};
	},

	MessageOperations_updateMessageFlags: async (context) => {
		const { messageId } = context.request.params as { messageId: string };
		const { isRead, isStarred, starColor } = context.request.requestBody as {
			isRead?: boolean;
			isStarred?: boolean;
			starColor?: string;
		};

		const client = getClient();

		// Resolve accountId from message -> mailbox
		const message = await client.message.get(messageId);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// FlagQueueService handles: MessageFlag + ThreadMessage updates + SQS event
		const result = await client.flagQueue.updateFlags(
			messageId,
			mailbox.accountId,
			{ isRead, isStarred, starColor: starColor as StarColorValue | undefined },
		);

		return {
			messageId: result.messageId,
			isRead: result.isRead,
			isStarred: result.isStarred,
		};
	},
};

export const MessageBulkOperations: Record<
	MessageBulkOperationIds,
	OperationHandler<MessageBulkOperationIds>
> = {
	MessageBulkOperations_deleteMessages: async (context) => {
		const { messageIds } = context.request.requestBody as {
			messageIds: string[];
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();

		// Resolve accountId from first message -> mailbox
		const message = await client.message.get(messageIds[0]);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// MessageMoveService handles: Message + ThreadMessage updates + SQS events
		await client.messageMove.deleteMessages(messageIds, mailbox.accountId);

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_moveMessages: async (context) => {
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();

		// Verify destination mailbox exists
		await client.mailbox.get(destinationMailboxId);

		// Resolve accountId from first message -> mailbox
		const message = await client.message.get(messageIds[0]);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// MessageMoveService handles: Message + ThreadMessage updates + SQS events
		await client.messageMove.moveMessages(
			messageIds,
			destinationMailboxId,
			mailbox.accountId,
		);

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},
};
