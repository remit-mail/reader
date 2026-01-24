import type { UpdateThreadMessageInput } from "@remit/remit-electrodb-service";
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

		// Get current thread message to update
		const threadMessage = await client.threadMessage.getByMessageId(messageId);

		// Build update payload
		type StarColorType = UpdateThreadMessageInput["star"];

		const updatePayload: {
			isRead?: boolean;
			hasStars?: boolean;
			star?: StarColorType;
		} = {};

		if (isRead !== undefined) {
			updatePayload.isRead = isRead;
		}
		if (isStarred !== undefined) {
			updatePayload.hasStars = isStarred;
			if (isStarred && starColor) {
				updatePayload.star = starColor as StarColorType;
			} else if (!isStarred) {
				updatePayload.star = "none";
			}
		}

		// Update thread message with composite values for index regeneration
		const updated = await client.threadMessage.update(
			threadMessage.accountConfigId,
			threadMessage.threadMessageId,
			updatePayload,
			{
				composites: {
					sentDate: threadMessage.sentDate,
					mailboxId: threadMessage.mailboxId,
					isRead: updatePayload.isRead ?? threadMessage.isRead,
					isDeleted: threadMessage.isDeleted,
					hasStars: updatePayload.hasStars ?? threadMessage.hasStars,
					hasAttachment: threadMessage.hasAttachment,
				},
			},
		);

		// Update message flags in DynamoDB
		if (isRead !== undefined) {
			if (isRead) {
				await client.messageFlag.addFlag(messageId, "\\Seen");
			} else {
				await client.messageFlag.removeFlag(messageId, "\\Seen");
			}
		}

		if (isStarred !== undefined) {
			if (isStarred) {
				await client.messageFlag.addFlag(messageId, "\\Flagged");
			} else {
				await client.messageFlag.removeFlag(messageId, "\\Flagged");
			}
		}

		return {
			messageId,
			isRead: updated.isRead,
			isStarred: updated.hasStars,
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

		const client = getClient();
		let successCount = 0;
		const failedIds: string[] = [];

		for (const messageId of messageIds) {
			try {
				// Mark message as deleted
				await client.message.update(messageId, {
					status: "deleting",
					syncStatus: "pending",
				});

				// Update thread message
				const threadMessage =
					await client.threadMessage.findByMessageId(messageId);
				if (threadMessage) {
					await client.threadMessage.update(
						threadMessage.accountConfigId,
						threadMessage.threadMessageId,
						{ isDeleted: true },
						{
							composites: {
								sentDate: threadMessage.sentDate,
								mailboxId: threadMessage.mailboxId,
								isRead: threadMessage.isRead,
								isDeleted: true,
								hasStars: threadMessage.hasStars,
								hasAttachment: threadMessage.hasAttachment,
							},
						},
					);
				}

				successCount++;
			} catch {
				failedIds.push(messageId);
			}
		}

		return {
			successCount,
			failureCount: failedIds.length,
			failedIds: failedIds.length > 0 ? failedIds : undefined,
		};
	},

	MessageBulkOperations_moveMessages: async (context) => {
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		const client = getClient();
		let successCount = 0;
		const failedIds: string[] = [];

		// Verify destination mailbox exists
		await client.mailbox.get(destinationMailboxId);

		for (const messageId of messageIds) {
			try {
				// Get current message
				const message = await client.message.get(messageId);

				// Mark message as moving
				await client.message.updateForMove(messageId, {
					status: "moving",
					syncStatus: "pending",
					originalMailboxId: message.mailboxId,
					originalUid: message.uid,
					mailboxId: destinationMailboxId,
				});

				// Update thread message mailbox
				const threadMessage =
					await client.threadMessage.findByMessageId(messageId);
				if (threadMessage) {
					await client.threadMessage.update(
						threadMessage.accountConfigId,
						threadMessage.threadMessageId,
						{ mailboxId: destinationMailboxId },
						{
							composites: {
								sentDate: threadMessage.sentDate,
								mailboxId: destinationMailboxId,
								isRead: threadMessage.isRead,
								isDeleted: threadMessage.isDeleted,
								hasStars: threadMessage.hasStars,
								hasAttachment: threadMessage.hasAttachment,
							},
						},
					);
				}

				successCount++;
			} catch {
				failedIds.push(messageId);
			}
		}

		return {
			successCount,
			failureCount: failedIds.length,
			failedIds: failedIds.length > 0 ? failedIds : undefined,
		};
	},
};
