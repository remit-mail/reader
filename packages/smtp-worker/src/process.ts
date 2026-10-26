export type {
	AppendSentMessageEvent,
	SendMessageEvent,
	SmtpEvent,
} from "./events.js";
export type { AttachmentReader } from "./handlers/attachment-storage.js";
export {
	handleSendMessage,
	type SendMessageContext,
} from "./handlers/send-message.js";
export type { SmtpDataPorts } from "./ports.js";
