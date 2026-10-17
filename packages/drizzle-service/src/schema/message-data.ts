import * as entities from "@remit/drizzle-sqlite-schema";
import { OUTBOX_EVENTS, type OutboxEvent, outboxTable } from "./outbox.js";

export { OUTBOX_EVENTS, type OutboxEvent, outboxTable };

const bodyPartContentTable = entities.bodyPartContents;
const bodyPartParameterTable = entities.bodyPartParameters;
const bodyPartStorageTable = entities.bodyPartStorages;
const bodyPartTable = entities.bodyParts;
const bodyStructureRefetchTable = entities.bodyStructureRefetches;
const envelopeAddressTable = entities.envelopeAddresses;
const envelopeTable = entities.envelopes;
const messageFlagTable = entities.messageFlags;
const messageReferenceTable = entities.messageReferences;
const messageTable = entities.messageRecords;
const rawMessageStorageTable = entities.rawMessageStorages;

export {
	bodyPartContentTable,
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
	bodyStructureRefetchTable,
	envelopeAddressTable,
	envelopeTable,
	messageFlagTable,
	messageReferenceTable,
	messageTable,
	rawMessageStorageTable,
};

export const messageDataSchema = {
	envelope: envelopeTable,
	messageReference: messageReferenceTable,
	envelopeAddress: envelopeAddressTable,
	bodyPart: bodyPartTable,
	bodyPartParameter: bodyPartParameterTable,
	rawMessageStorage: rawMessageStorageTable,
	bodyPartStorage: bodyPartStorageTable,
	bodyPartContent: bodyPartContentTable,
	bodyStructureRefetch: bodyStructureRefetchTable,
	message: messageTable,
	messageFlag: messageFlagTable,
	outbox: outboxTable,
};

export type MessageDataSchema = typeof messageDataSchema;
