import { entities } from "./active-entities.js";
import { outboxTable } from "./outbox.js";

export { outboxTable };

const bodyPartContentTable = entities.bodyPartContents;
const bodyPartParameterTable = entities.bodyPartParameters;
const bodyPartStorageTable = entities.bodyPartStorages;
const bodyPartTable = entities.bodyParts;
const envelopeAddressTable = entities.envelopeAddresses;
const envelopeTable = entities.envelopes;
const messageFlagTable = entities.messageFlags;
const messageReferenceTable = entities.messageReferences;
const messageTable = entities.messages;
const rawMessageStorageTable = entities.rawMessageStorages;

export {
	bodyPartContentTable,
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
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
	message: messageTable,
	messageFlag: messageFlagTable,
	outbox: outboxTable,
};

export type MessageDataSchema = typeof messageDataSchema;
