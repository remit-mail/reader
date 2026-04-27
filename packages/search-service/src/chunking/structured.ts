import type {
	AttachmentChunkInput,
	Chunk,
	EnvelopeChunkAddress,
	EnvelopeChunkInput,
} from "../types.js";

const formatAddress = (addr: EnvelopeChunkAddress): string => {
	if (addr.name && addr.name.trim().length > 0) {
		return `${addr.name} <${addr.email}>`;
	}
	return addr.email;
};

const formatAttachment = (att: AttachmentChunkInput): string => {
	const filename = att.filename ?? "unnamed";
	const sizeKb = Math.max(1, Math.round(att.size / 1024));
	return `${filename} (${att.contentType}, ${sizeKb}KB)`;
};

export const buildStructuredChunks = (
	envelope: EnvelopeChunkInput,
	chunkIdFor: (suffix: string) => string,
): Chunk[] => {
	const chunks: Chunk[] = [];

	chunks.push({
		chunkId: chunkIdFor("sender"),
		chunkType: "sender",
		text: `From: ${formatAddress(envelope.from)}`,
	});

	const recipients = [...envelope.to, ...envelope.cc, ...envelope.bcc];
	if (recipients.length > 0) {
		chunks.push({
			chunkId: chunkIdFor("recipient"),
			chunkType: "recipient",
			text: `To: ${recipients.map(formatAddress).join(", ")}`,
		});
	}

	const subject = envelope.subject.trim();
	if (subject.length > 0) {
		chunks.push({
			chunkId: chunkIdFor("subject"),
			chunkType: "subject",
			text: `Subject: ${subject}`,
		});
	}

	if (envelope.attachments.length > 0) {
		chunks.push({
			chunkId: chunkIdFor("attachment"),
			chunkType: "attachment",
			text: `Attachments: ${envelope.attachments.map(formatAttachment).join(", ")}`,
		});
	}

	return chunks;
};

export const extractAttachmentFileTypes = (
	attachments: AttachmentChunkInput[],
): string[] => {
	const types = new Set<string>();
	for (const att of attachments) {
		if (att.filename) {
			const dot = att.filename.lastIndexOf(".");
			if (dot > 0 && dot < att.filename.length - 1) {
				types.add(att.filename.slice(dot + 1).toLowerCase());
			}
		}
		const slash = att.contentType.lastIndexOf("/");
		if (slash > 0) {
			types.add(att.contentType.slice(slash + 1).toLowerCase());
		}
	}
	return Array.from(types);
};
