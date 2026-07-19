const XMLNS = "http://queue.amazonaws.com/doc/2012-11-05/";

export const escapeXml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");

const tag = (name: string, value: string): string =>
	`<${name}>${escapeXml(value)}</${name}>`;

const metadata = (requestId: string): string =>
	`<ResponseMetadata><RequestId>${requestId}</RequestId></ResponseMetadata>`;

/**
 * Wraps an action's result body in the AWS Query envelope the SDK's
 * `AwsQueryProtocol` deserializer expects: `<ActionResponse>` containing
 * `<ActionResult>` and `<ResponseMetadata>`.
 */
export const queryResponse = (
	action: string,
	resultBody: string,
	requestId: string,
): string =>
	`<?xml version="1.0"?>` +
	`<${action}Response xmlns="${XMLNS}">` +
	`<${action}Result>${resultBody}</${action}Result>` +
	metadata(requestId) +
	`</${action}Response>`;

/** For actions with no result payload (DeleteMessage, PurgeQueue). */
export const queryResponseNoResult = (
	action: string,
	requestId: string,
): string =>
	`<?xml version="1.0"?>` +
	`<${action}Response xmlns="${XMLNS}">` +
	metadata(requestId) +
	`</${action}Response>`;

export const errorResponse = (
	code: string,
	message: string,
	requestId: string,
	senderFault = true,
): string =>
	`<?xml version="1.0"?>` +
	`<ErrorResponse xmlns="${XMLNS}">` +
	`<Error>` +
	tag("Type", senderFault ? "Sender" : "Receiver") +
	tag("Code", code) +
	tag("Message", message) +
	`</Error>` +
	`<RequestId>${requestId}</RequestId>` +
	`</ErrorResponse>`;

export const sendMessageResult = (result: {
	messageId: string;
	md5OfBody: string;
	sequenceNumber: string | null;
}): string =>
	tag("MessageId", result.messageId) +
	tag("MD5OfMessageBody", result.md5OfBody) +
	(result.sequenceNumber ? tag("SequenceNumber", result.sequenceNumber) : "");

export const sendMessageBatchResult = (
	entries: {
		id: string;
		messageId: string;
		md5OfBody: string;
		sequenceNumber: string | null;
	}[],
): string =>
	entries
		.map(
			(e) =>
				`<SendMessageBatchResultEntry>` +
				tag("Id", e.id) +
				tag("MessageId", e.messageId) +
				tag("MD5OfMessageBody", e.md5OfBody) +
				(e.sequenceNumber ? tag("SequenceNumber", e.sequenceNumber) : "") +
				`</SendMessageBatchResultEntry>`,
		)
		.join("");

export interface ReceiveMessageXml {
	messageId: string;
	receiptHandle: string;
	md5OfBody: string;
	body: string;
	attributes: Record<string, string>;
}

export const receiveMessageResult = (messages: ReceiveMessageXml[]): string =>
	messages
		.map((m) => {
			const attrs = Object.entries(m.attributes)
				.map(
					([name, value]) =>
						`<Attribute>${tag("Name", name)}${tag("Value", value)}</Attribute>`,
				)
				.join("");
			return (
				`<Message>` +
				tag("MessageId", m.messageId) +
				tag("ReceiptHandle", m.receiptHandle) +
				tag("MD5OfBody", m.md5OfBody) +
				tag("Body", m.body) +
				attrs +
				`</Message>`
			);
		})
		.join("");

export const queueUrlResult = (queueUrl: string): string =>
	tag("QueueUrl", queueUrl);

export const queueAttributesResult = (
	attributes: Record<string, string>,
): string =>
	Object.entries(attributes)
		.map(
			([name, value]) =>
				`<Attribute>${tag("Name", name)}${tag("Value", value)}</Attribute>`,
		)
		.join("");
