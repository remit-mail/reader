import type {
	BodyPartContentUpsertInput,
	BodyPartItem,
	BodyPartUpsertInput,
	CreateEnvelopeInput,
	EnvelopeItem,
	IEnvelopeRepository,
	MessageData,
	UpdateEnvelopeInput,
} from "@remit/data-ports";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import {
	CreateFailedConflictError,
	isUniqueViolation,
	NotFoundError,
} from "../error.js";
import {
	bodyPartContentId as deriveBodyPartContentId,
	bodyPartId as deriveBodyPartId,
	bodyPartParameterId as deriveBodyPartParameterId,
	envelopeId as deriveEnvelopeId,
} from "../id.js";
import {
	bodyPartContentTable,
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
	envelopeAddressTable,
	envelopeTable,
	type MessageDataSchema,
	messageReferenceTable,
	rawMessageStorageTable,
} from "../schema/message-data.js";
import {
	toBodyPartContentItem,
	toBodyPartItem,
	toBodyPartParameterItem,
	toBodyPartStorageItem,
	toEnvelopeAddressItem,
	toEnvelopeItem,
	toMessageReferenceItem,
	toRawMessageStorageItem,
} from "./mappers.js";

type DB = Db<MessageDataSchema>;

function dedupeById<T>(rows: T[], getId: (row: T) => string): T[] {
	const byId = new Map<string, T>();
	for (const row of rows) {
		byId.set(getId(row), row);
	}
	return [...byId.values()];
}

export class DrizzleEnvelopeRepository implements IEnvelopeRepository {
	constructor(private db: DB) {}

	async getMessageData(messageId: string): Promise<MessageData> {
		const [
			envelopes,
			messageReferences,
			envelopeAddresses,
			bodyParts,
			bodyPartParameters,
			rawMessageStorages,
			bodyPartStorages,
			bodyPartContents,
		] = await Promise.all([
			this.db
				.select()
				.from(envelopeTable)
				.where(eq(envelopeTable.messageId, messageId)),
			this.db
				.select()
				.from(messageReferenceTable)
				.where(eq(messageReferenceTable.messageId, messageId)),
			this.db
				.select()
				.from(envelopeAddressTable)
				.where(eq(envelopeAddressTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartTable)
				.where(eq(bodyPartTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartParameterTable)
				.where(eq(bodyPartParameterTable.messageId, messageId)),
			this.db
				.select()
				.from(rawMessageStorageTable)
				.where(eq(rawMessageStorageTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartStorageTable)
				.where(eq(bodyPartStorageTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartContentTable)
				.where(eq(bodyPartContentTable.messageId, messageId)),
		]);

		if (envelopes.length === 0) {
			throw new NotFoundError(`Message data not found: ${messageId}`);
		}

		return {
			envelope: envelopes.map(toEnvelopeItem),
			messageReference: messageReferences.map(toMessageReferenceItem),
			envelopeAddress: envelopeAddresses.map(toEnvelopeAddressItem),
			bodyPart: bodyParts.map(toBodyPartItem),
			bodyPartParameter: bodyPartParameters.map(toBodyPartParameterItem),
			rawMessageStorage: rawMessageStorages.map(toRawMessageStorageItem),
			bodyPartStorage: bodyPartStorages.map(toBodyPartStorageItem),
			bodyPartContent: bodyPartContents.map(toBodyPartContentItem),
		};
	}

	async upsertBodyParts(
		messageId: string,
		parts: BodyPartUpsertInput[],
	): Promise<void> {
		if (parts.length === 0) return;

		const now = Date.now();

		const bodyPartRows = parts.map((part) => ({
			bodyPartId: deriveBodyPartId(messageId, part.partPath),
			messageId,
			partPath: part.partPath,
			mediaType: part.mediaType,
			mediaSubtype: part.mediaSubtype,
			transferEncoding: part.transferEncoding,
			sizeOctets: part.sizeOctets,
			isMultipart: part.isMultipart,
			parentBodyPartId:
				part.parentPartPath !== null
					? deriveBodyPartId(messageId, part.parentPartPath)
					: null,
			contentId: part.contentId ?? null,
			contentDescription: part.contentDescription ?? null,
			lineCount: part.lineCount ?? null,
			md5Hash: part.md5Hash ?? null,
			disposition: part.disposition ?? null,
			dispositionFilename: part.dispositionFilename ?? null,
			language: part.language ?? null,
			location: part.location ?? null,
			multipartSubtype: part.multipartSubtype ?? null,
			createdAt: now,
			updatedAt: now,
		}));

		const parameterRows = parts.flatMap((part) =>
			part.parameters.map((param) => ({
				bodyPartParameterId: deriveBodyPartParameterId(
					messageId,
					part.partPath,
					param.parameterName,
				),
				messageId,
				bodyPartId: deriveBodyPartId(messageId, part.partPath),
				parameterName: param.parameterName,
				parameterValue: param.parameterValue,
				createdAt: now,
				updatedAt: now,
			})),
		);

		// The MIME walker assigns synthetic partPaths for nodes imapflow returns
		// without a `part` field (e.g. the inner body of a message/rfc822
		// attachment), which can produce duplicate ids. A single
		// INSERT ... ON CONFLICT DO UPDATE fails (SQLSTATE 21000) if the same
		// conflict-target id appears twice, so dedupe first (last-write-wins),
		// matching the ElectroDB `seen` guard.
		const dedupedBodyPartRows = dedupeById(bodyPartRows, (r) => r.bodyPartId);
		const dedupedParameterRows = dedupeById(
			parameterRows,
			(r) => r.bodyPartParameterId,
		);

		await this.db.transaction(async (tx) => {
			await tx
				.insert(bodyPartTable)
				.values(dedupedBodyPartRows)
				.onConflictDoUpdate({
					target: bodyPartTable.bodyPartId,
					set: { updatedAt: now },
				});

			if (dedupedParameterRows.length > 0) {
				await tx
					.insert(bodyPartParameterTable)
					.values(dedupedParameterRows)
					.onConflictDoUpdate({
						target: bodyPartParameterTable.bodyPartParameterId,
						set: {
							parameterValue: bodyPartParameterTable.parameterValue,
							updatedAt: now,
						},
					});
			}
		});
	}

	async deleteManyEnvelopes(envelopeIds: string[]): Promise<void> {
		if (envelopeIds.length === 0) return;

		await this.db.transaction(async (tx) => {
			await tx
				.delete(envelopeTable)
				.where(inArray(envelopeTable.envelopeId, envelopeIds));
		});
	}

	async createEnvelope(input: CreateEnvelopeInput): Promise<EnvelopeItem> {
		const now = Date.now();
		const row = {
			...input,
			envelopeId: deriveEnvelopeId(input.messageId),
			subject: input.subject ?? null,
			messageIdValue: input.messageIdValue ?? null,
			createdAt: now,
			updatedAt: now,
		};
		try {
			await this.db.insert(envelopeTable).values(row);
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new CreateFailedConflictError("Envelope", input);
			}
			throw error;
		}
		return toEnvelopeItem(row as typeof envelopeTable.$inferSelect);
	}

	async upsertEnvelope(input: CreateEnvelopeInput): Promise<EnvelopeItem> {
		const now = Date.now();
		const row = {
			...input,
			envelopeId: deriveEnvelopeId(input.messageId),
			subject: input.subject ?? null,
			messageIdValue: input.messageIdValue ?? null,
			createdAt: now,
			updatedAt: now,
		};
		await this.db
			.insert(envelopeTable)
			.values(row)
			.onConflictDoUpdate({
				target: envelopeTable.envelopeId,
				set: {
					subject: row.subject,
					messageIdValue: row.messageIdValue,
					updatedAt: now,
				},
			});
		return toEnvelopeItem(row as typeof envelopeTable.$inferSelect);
	}

	async getEnvelope(envelopeId: string): Promise<EnvelopeItem>;
	async getEnvelope(envelopeIds: string[]): Promise<EnvelopeItem[]>;
	async getEnvelope(
		envelopeId: string | string[],
	): Promise<EnvelopeItem | EnvelopeItem[]> {
		if (Array.isArray(envelopeId)) {
			if (envelopeId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(envelopeTable)
				.where(inArray(envelopeTable.envelopeId, envelopeId));
			return rows.map(toEnvelopeItem);
		}

		const rows = await this.db
			.select()
			.from(envelopeTable)
			.where(eq(envelopeTable.envelopeId, envelopeId));
		if (rows.length === 0) {
			throw new NotFoundError(`Envelope not found: ${envelopeId}`);
		}
		return toEnvelopeItem(rows[0]);
	}

	async updateEnvelope(
		envelopeId: string,
		input: UpdateEnvelopeInput,
	): Promise<EnvelopeItem> {
		const now = Date.now();
		await this.db
			.update(envelopeTable)
			.set({ ...input, updatedAt: now })
			.where(eq(envelopeTable.envelopeId, envelopeId));
		return this.getEnvelope(envelopeId);
	}

	async deleteEnvelope(envelopeId: string): Promise<void> {
		await this.db
			.delete(envelopeTable)
			.where(eq(envelopeTable.envelopeId, envelopeId));
	}

	async upsertBodyPartContents(
		messageId: string,
		contents: BodyPartContentUpsertInput[],
	): Promise<void> {
		if (contents.length === 0) return;

		const now = Date.now();

		const rows = contents.map((c) => ({
			bodyPartContentId: deriveBodyPartContentId(messageId, c.bodyPartId),
			messageId,
			bodyPartId: c.bodyPartId,
			content: c.content,
			contentLength: c.content.length,
			createdAt: now,
			updatedAt: now,
		}));

		await this.db
			.insert(bodyPartContentTable)
			.values(rows)
			.onConflictDoUpdate({
				target: bodyPartContentTable.bodyPartContentId,
				set: {
					content: bodyPartContentTable.content,
					contentLength: bodyPartContentTable.contentLength,
					updatedAt: now,
				},
			});
	}

	async listBodyParts(messageId: string): Promise<BodyPartItem[]> {
		const rows = await this.db
			.select()
			.from(bodyPartTable)
			.where(eq(bodyPartTable.messageId, messageId));
		return rows.map(toBodyPartItem);
	}
}
