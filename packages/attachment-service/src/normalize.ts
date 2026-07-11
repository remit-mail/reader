const NUL_CHARACTER = String.fromCharCode(0);
const EXCESS_BLANK_LINES_PATTERN = /\n{4,}/g;
const MAX_COLLAPSED_BLANK_LINES = "\n\n\n";

export const normalizeText = (text: string): string => {
	return text
		.split(NUL_CHARACTER)
		.join("")
		.replace(EXCESS_BLANK_LINES_PATTERN, MAX_COLLAPSED_BLANK_LINES);
};

export interface TruncationResult {
	text: string;
	truncated: boolean;
}

const UTF8_CONTINUATION_MASK = 0xc0;
const UTF8_CONTINUATION_TAG = 0x80;
const UTF8_MAX_SEQUENCE_LENGTH = 4;

const utf8SequenceLength = (leadByte: number): number => {
	if ((leadByte & 0xe0) === 0xc0) return 2;
	if ((leadByte & 0xf0) === 0xe0) return 3;
	if ((leadByte & 0xf8) === 0xf0) return 4;
	return 1;
};

const safeUtf8TruncationEnd = (buffer: Buffer, end: number): number => {
	for (
		let back = 1;
		back <= UTF8_MAX_SEQUENCE_LENGTH - 1 && end - back >= 0;
		back++
	) {
		const byte = buffer[end - back];
		if (byte === undefined) break;
		const isContinuationByte =
			(byte & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_TAG;
		if (isContinuationByte) continue;

		const sequenceStart = end - back;
		const sequenceLength = utf8SequenceLength(byte);
		if (sequenceStart + sequenceLength > end) return sequenceStart;
		return end;
	}
	return end;
};

export const truncateToByteLimit = (
	text: string,
	maxTextBytes: number,
): TruncationResult => {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.length <= maxTextBytes) {
		return { text, truncated: false };
	}

	const end = safeUtf8TruncationEnd(buffer, maxTextBytes);
	const slice = buffer.subarray(0, end);
	return { text: slice.toString("utf8"), truncated: true };
};
