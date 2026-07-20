import type { QuarantineItem } from "@remit/data-ports";
import { QuarantineFailureCode } from "@remit/domain-enums";
import { type ParsedMail, simpleParser } from "mailparser";

type FailureCode = QuarantineItem["failureCode"];

/**
 * The message body could not be parsed.
 *
 * This type is the whole reason the sync path can quarantine anything. Before
 * it, every catch site on the body path saw one undifferentiated `unknown`
 * covering mailparser, S3, DynamoDB and SQS alike, so "the message is built in
 * a way Remit could not read" was indistinguishable from "S3 returned a 503".
 * Recording the second as the first advances the cursor past mail that is
 * perfectly fine and never fetches it again.
 *
 * Only {@link parseMessageBody} constructs one, and its try block contains the
 * parse call and nothing else — so an instance of this type is proof that the
 * message, not the infrastructure, is what failed. Everything else propagates.
 */
export class BodyParseError extends Error {
	readonly failureCode: FailureCode;

	constructor(cause: unknown) {
		const message = cause instanceof Error ? cause.message : String(cause);
		super(message, { cause });
		this.name = "BodyParseError";
		this.failureCode = classifyBodyParseFailure(message);
	}
}

/**
 * mailparser reports its refusals as free text with no stable type, code or
 * class, so the closed failure vocabulary can only name a defect it can
 * recognise without reading parser prose. The charset decoder is the one that
 * says the same thing every time, because the sentence comes from iconv rather
 * than the parser. Anything else is `UnreadableBody`, and the parser's own
 * words go to `failureMessage`, which is shown on screen and never published.
 *
 * Guessing more finely than this would put a wrong, unfalsifiable code in the
 * title of an issue filed under the user's own account.
 */
const UNKNOWN_CHARSET = /unknown charset|unsupported charset|invalid encoding/i;

const classifyBodyParseFailure = (message: string): FailureCode =>
	UNKNOWN_CHARSET.test(message)
		? QuarantineFailureCode.UnknownCharset
		: QuarantineFailureCode.UnreadableBody;

/**
 * Parse a raw RFC822 body, distinguishing a message defect from everything
 * else. The try block is the parse call alone; nothing that touches storage,
 * the queue or the database may be moved inside it.
 */
export const parseMessageBody = async (body: Buffer): Promise<ParsedMail> => {
	try {
		return await simpleParser(body);
	} catch (error) {
		throw new BodyParseError(error);
	}
};
