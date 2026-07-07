import type {
	BodyPartContentUpsertInput,
	BodyPartItem,
	BodyPartUpsertInput,
	CreateEnvelopeInput,
	EnvelopeItem,
	MessageData,
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
	getMessageData(messageId: string): Promise<MessageData>;
	listBodyParts(messageId: string): Promise<BodyPartItem[]>;
}
