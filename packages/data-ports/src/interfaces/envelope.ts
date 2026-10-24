import type {
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
	replaceMessageReferences(
		messageId: string,
		references: MessageReferenceInput[],
	): Promise<void>;
	getMessageData(messageId: string): Promise<MessageData>;
	listBodyParts(messageId: string): Promise<BodyPartItem[]>;
	/**
	 * Up to `limit` messages now in the folder that are queued to have their
	 * structure read again from the mail server.
	 */
	listQueuedStructureRefetches(
		mailboxId: string,
		limit: number,
	): Promise<Array<{ messageId: string; uid: number }>>;
	/** Take messages off that queue, once each. */
	clearStructureRefetches(messageIds: string[]): Promise<void>;
}
