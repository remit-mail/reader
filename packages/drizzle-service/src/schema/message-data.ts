import * as entities from "@remit/drizzle-sqlite-schema";

const bodyPartParameterTable = entities.bodyPartParameters;
const bodyPartTable = entities.bodyParts;
const bodyStructureRefetchTable = entities.bodyStructureRefetches;
const envelopeAddressTable = entities.envelopeAddresses;
const envelopeTable = entities.envelopes;
const messageFlagTable = entities.messageFlags;
const messageReferenceTable = entities.messageReferences;
const messageSearchTextTable = entities.messageSearchTexts;
const messageTable = entities.messageRecords;
const rawMessageStorageTable = entities.rawMessageStorages;

export {
	bodyPartParameterTable,
	bodyPartTable,
	bodyStructureRefetchTable,
	envelopeAddressTable,
	envelopeTable,
	messageFlagTable,
	messageReferenceTable,
	messageSearchTextTable,
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
	bodyStructureRefetch: bodyStructureRefetchTable,
	message: messageTable,
	messageFlag: messageFlagTable,
	messageSearchText: messageSearchTextTable,
};

export type MessageDataSchema = typeof messageDataSchema;
