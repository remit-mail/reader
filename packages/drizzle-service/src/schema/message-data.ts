import * as entities from "@remit/drizzle-sqlite-schema";

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
	bodyStructureRefetch: bodyStructureRefetchTable,
	message: messageTable,
	messageFlag: messageFlagTable,
};

export type MessageDataSchema = typeof messageDataSchema;
