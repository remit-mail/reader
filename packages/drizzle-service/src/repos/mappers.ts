import type {
	BodyPartContentItem,
	BodyPartItem,
	BodyPartParameterItem,
	BodyPartStorageItem,
	EnvelopeAddressItem,
	EnvelopeItem,
	MessageReferenceItem,
	RawMessageStorageItem,
} from "@remit/data-ports";
import type {
	bodyPartContentTable,
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
	envelopeAddressTable,
	envelopeTable,
	messageReferenceTable,
	rawMessageStorageTable,
} from "../schema/message-data.js";

export function toEnvelopeItem(
	row: typeof envelopeTable.$inferSelect,
): EnvelopeItem {
	return {
		envelopeId: row.envelopeId,
		messageId: row.messageId,
		dateValue: row.dateValue,
		dateRaw: row.dateRaw,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.subject !== null ? { subject: row.subject } : {}),
		...(row.messageIdValue !== null
			? { messageIdValue: row.messageIdValue }
			: {}),
	};
}

export function toMessageReferenceItem(
	row: typeof messageReferenceTable.$inferSelect,
): MessageReferenceItem {
	return {
		messageReferenceId: row.messageReferenceId,
		messageId: row.messageId,
		envelopeId: row.envelopeId,
		messageIdValue: row.messageIdValue,
		referenceType: row.referenceType,
		referenceOrder: row.referenceOrder,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function toEnvelopeAddressItem(
	row: typeof envelopeAddressTable.$inferSelect,
): EnvelopeAddressItem {
	return {
		envelopeAddressId: row.envelopeAddressId,
		messageId: row.messageId,
		addressId: row.addressId,
		normalizedEmail: row.normalizedEmail,
		addressRole: row.addressRole,
		addressOrder: row.addressOrder,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.displayName !== null ? { displayName: row.displayName } : {}),
	};
}

export function toBodyPartItem(
	row: typeof bodyPartTable.$inferSelect,
): BodyPartItem {
	return {
		bodyPartId: row.bodyPartId,
		messageId: row.messageId,
		partPath: row.partPath,
		mediaType: row.mediaType,
		mediaSubtype: row.mediaSubtype,
		transferEncoding: row.transferEncoding,
		sizeOctets: row.sizeOctets,
		isMultipart: row.isMultipart,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.parentBodyPartId !== null
			? { parentBodyPartId: row.parentBodyPartId }
			: {}),
		...(row.contentId !== null ? { contentId: row.contentId } : {}),
		...(row.contentDescription !== null
			? { contentDescription: row.contentDescription }
			: {}),
		...(row.lineCount !== null ? { lineCount: row.lineCount } : {}),
		...(row.md5Hash !== null ? { md5Hash: row.md5Hash } : {}),
		...(row.disposition !== null ? { disposition: row.disposition } : {}),
		...(row.dispositionFilename !== null
			? { dispositionFilename: row.dispositionFilename }
			: {}),
		...(row.language !== null ? { language: row.language } : {}),
		...(row.location !== null ? { location: row.location } : {}),
		...(row.multipartSubtype !== null
			? { multipartSubtype: row.multipartSubtype }
			: {}),
	};
}

export function toBodyPartParameterItem(
	row: typeof bodyPartParameterTable.$inferSelect,
): BodyPartParameterItem {
	return {
		bodyPartParameterId: row.bodyPartParameterId,
		messageId: row.messageId,
		bodyPartId: row.bodyPartId,
		parameterName: row.parameterName,
		parameterValue: row.parameterValue,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function toRawMessageStorageItem(
	row: typeof rawMessageStorageTable.$inferSelect,
): RawMessageStorageItem {
	return {
		rawStorageId: row.rawStorageId,
		messageId: row.messageId,
		storageType: row.storageType,
		storageLocation: row.storageLocation,
		storageKey: row.storageKey,
		sizeBytes: row.sizeBytes,
		checksumSha256: row.checksumSha256,
		contentEncoding: row.contentEncoding,
		storedAt: row.storedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.expiresAt !== null ? { expiresAt: row.expiresAt } : {}),
	};
}

export function toBodyPartStorageItem(
	row: typeof bodyPartStorageTable.$inferSelect,
): BodyPartStorageItem {
	return {
		bodyPartStorageId: row.bodyPartStorageId,
		messageId: row.messageId,
		bodyPartId: row.bodyPartId,
		storageType: row.storageType,
		storageLocation: row.storageLocation,
		storageKey: row.storageKey,
		decodedSizeBytes: row.decodedSizeBytes,
		checksumSha256: row.checksumSha256,
		contentEncoding: row.contentEncoding,
		isDeduped: row.isDeduped,
		storedAt: row.storedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.dedupHash !== null ? { dedupHash: row.dedupHash } : {}),
	};
}

export function toBodyPartContentItem(
	row: typeof bodyPartContentTable.$inferSelect,
): BodyPartContentItem {
	return {
		bodyPartContentId: row.bodyPartContentId,
		messageId: row.messageId,
		bodyPartId: row.bodyPartId,
		content: row.content,
		contentLength: row.contentLength,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
