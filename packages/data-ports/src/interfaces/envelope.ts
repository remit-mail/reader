import type {
	BodyPartContentUpsertInput,
	BodyPartItem,
	BodyPartUpsertInput,
	CreateEnvelopeInput,
	EnvelopeItem,
	MessageData,
	MessageReferenceInput,
	UpdateEnvelopeInput,
} from "../types.js";

export interface IEnvelopeRepository {
	createEnvelope(input: CreateEnvelopeInput): Promise<EnvelopeItem>;
	upsertEnvelope(input: CreateEnvelopeInput): Promise<EnvelopeItem>;
	getEnvelope(envelopeId: string): Promise<EnvelopeItem>;
	getEnvelope(envelopeIds: string[]): Promise<EnvelopeItem[]>;
	updateEnvelope(
		envelopeId: string,
		input: UpdateEnvelopeInput,
	): Promise<EnvelopeItem>;
	deleteEnvelope(envelopeId: string): Promise<void>;
	deleteManyEnvelopes(envelopeIds: string[]): Promise<void>;
	upsertBodyParts(
		messageId: string,
		parts: BodyPartUpsertInput[],
	): Promise<void>;
	upsertBodyPartContents(
		messageId: string,
		contents: BodyPartContentUpsertInput[],
	): Promise<void>;
	replaceMessageReferences(
		messageId: string,
		references: MessageReferenceInput[],
	): Promise<void>;
	getMessageData(messageId: string): Promise<MessageData>;
	listBodyParts(messageId: string): Promise<BodyPartItem[]>;
	/**
	 * UIDs of up to `limit` messages in the folder that have no body part rows:
	 * their structure is still to be read from the mail server.
	 */
	listUidsWithoutBodyParts(mailboxId: string, limit: number): Promise<number[]>;
}
