import {
	AdminDeleteUserCommand,
	UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import {
	BodyPart,
	BodyPartContent,
	BodyPartParameter,
	BodyPartStorage,
	MessageReference,
	RawMessageStorage,
} from "@remit/electrodb-entities";
import type { Schema } from "electrodb";
import { Entity } from "electrodb";
import type { Logger } from "pino";
import { enumerateCascadeEntities } from "../cascade.js";
import {
	accountConfigService,
	cascadeServices,
	cognitoClient,
	ddbClient,
	tableName,
	userPoolId,
} from "../config.js";
import type { AccountFinalizeEvent } from "../events.js";

const BATCH_SIZE = 25;

const batchDeleteRawEntities = async (
	entitySchema: Schema<string, string, string>,
	idField: string,
	ids: string[],
): Promise<void> => {
	if (ids.length === 0) return;
	const entity = new Entity(entitySchema, {
		client: ddbClient,
		table: tableName,
	});
	for (let i = 0; i < ids.length; i += BATCH_SIZE) {
		const batch = ids.slice(i, i + BATCH_SIZE);
		const keys = batch.map((id) => ({ [idField]: id }));
		await entity.delete(keys).go();
	}
};

export const processAccountFinalize = async (
	event: AccountFinalizeEvent,
	log: Logger,
): Promise<void> => {
	const { accountConfigId } = event;

	log.info({ accountConfigId }, "Checking deletion guard");
	const accountConfig = await accountConfigService.get(accountConfigId);

	if (!accountConfig.deletedAt) {
		log.info({ accountConfigId }, "deletedAt not set, ack-dropping");
		return;
	}

	const { userId } = accountConfig;

	log.info(
		{ accountConfigId },
		"Enumerating child entities for cascade delete",
	);
	const { entities } = await enumerateCascadeEntities(
		accountConfigId,
		cascadeServices,
		log,
	);

	const entitiesToDelete = entities.filter(
		(e) => e.entityType !== "AccountConfig",
	);

	log.info(
		{ accountConfigId, count: entitiesToDelete.length },
		"Paginated cascade delete",
	);

	const {
		accountService,
		addressService,
		mailboxService,
		messageService,
		envelopeService,
		messageFlagService,
		outboxMessageService,
		threadMessageService,
		mailboxLockService,
	} = cascadeServices;

	const grouped = new Map<string, Record<string, string>[]>();
	for (const entity of entitiesToDelete) {
		const list = grouped.get(entity.entityType) ?? [];
		list.push(entity.key);
		grouped.set(entity.entityType, list);
	}

	const keysOf = (type: string): Record<string, string>[] =>
		grouped.get(type) ?? [];

	// Delete leaf entities first, then parents
	await batchDeleteRawEntities(
		BodyPartContent,
		"bodyPartContentId",
		keysOf("BodyPartContent").map((k) => k.bodyPartContentId),
	);
	await batchDeleteRawEntities(
		BodyPartStorage,
		"bodyPartStorageId",
		keysOf("BodyPartStorage").map((k) => k.bodyPartStorageId),
	);
	await batchDeleteRawEntities(
		BodyPartParameter,
		"bodyPartParameterId",
		keysOf("BodyPartParameter").map((k) => k.bodyPartParameterId),
	);
	await batchDeleteRawEntities(
		RawMessageStorage,
		"rawStorageId",
		keysOf("RawMessageStorage").map((k) => k.rawStorageId),
	);
	await batchDeleteRawEntities(
		BodyPart,
		"bodyPartId",
		keysOf("BodyPart").map((k) => k.bodyPartId),
	);
	await batchDeleteRawEntities(
		MessageReference,
		"messageReferenceId",
		keysOf("MessageReference").map((k) => k.messageReferenceId),
	);

	const envelopeAddressIds = keysOf("EnvelopeAddress").map(
		(k) => k.envelopeAddressId,
	);
	if (envelopeAddressIds.length > 0) {
		log.info(
			{ count: envelopeAddressIds.length },
			"Deleting EnvelopeAddresses",
		);
		await addressService.deleteManyEnvelopeAddresses(envelopeAddressIds);
	}

	const envelopeIds = keysOf("Envelope").map((k) => k.envelopeId);
	if (envelopeIds.length > 0) {
		log.info({ count: envelopeIds.length }, "Deleting Envelopes");
		await envelopeService.deleteManyEnvelopes(envelopeIds);
	}

	const messageFlagIds = keysOf("MessageFlag").map((k) => k.messageFlagId);
	if (messageFlagIds.length > 0) {
		log.info({ count: messageFlagIds.length }, "Deleting MessageFlags");
		await messageFlagService.deleteMany(messageFlagIds);
	}

	const messageIds = keysOf("Message").map((k) => k.messageId);
	if (messageIds.length > 0) {
		log.info({ count: messageIds.length }, "Deleting Messages");
		await messageService.deleteMany(messageIds);
	}

	const mailboxLockKeys = keysOf("MailboxLock");
	if (mailboxLockKeys.length > 0) {
		log.info({ count: mailboxLockKeys.length }, "Deleting MailboxLocks");
		for (const account of entities.filter((e) => e.entityType === "Account")) {
			await mailboxLockService.deleteByAccount(account.key.accountId);
		}
	}

	const outboxIds = keysOf("OutboxMessage").map((k) => k.outboxMessageId);
	if (outboxIds.length > 0) {
		log.info({ count: outboxIds.length }, "Deleting OutboxMessages");
		await outboxMessageService.deleteMany(outboxIds);
	}

	const threadMessageKeys = keysOf("ThreadMessage");
	if (threadMessageKeys.length > 0) {
		log.info({ count: threadMessageKeys.length }, "Deleting ThreadMessages");
		await threadMessageService.deleteAllByAccount(accountConfigId);
	}

	const mailboxIds = keysOf("Mailbox").map((k) => k.mailboxId);
	if (mailboxIds.length > 0) {
		log.info({ count: mailboxIds.length }, "Deleting Mailboxes");
		await mailboxService.deleteMany(mailboxIds);
	}

	const addressIds = keysOf("Address").map((k) => k.addressId);
	if (addressIds.length > 0) {
		log.info({ count: addressIds.length }, "Deleting Addresses");
		await addressService.deleteManyAddresses(addressIds);
	}

	const accountIds = keysOf("Account").map((k) => k.accountId);
	if (accountIds.length > 0) {
		log.info({ count: accountIds.length }, "Deleting Accounts");
		await accountService.deleteMany(accountIds);
	}

	log.info({ accountConfigId, userId }, "Deleting Cognito user");
	try {
		await cognitoClient.send(
			new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: userId }),
		);
	} catch (error: unknown) {
		if (error instanceof UserNotFoundException) {
			log.info({ userId }, "Cognito user already deleted");
		} else {
			throw error;
		}
	}

	log.info({ accountConfigId }, "Deleting AccountConfig (final)");
	await accountConfigService.delete(accountConfigId);

	log.info({ accountConfigId }, "Account finalize complete");
};
