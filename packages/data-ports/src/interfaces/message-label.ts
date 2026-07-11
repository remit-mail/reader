import type { CreateMessageLabelInput, MessageLabelItem } from "../types.js";

export interface IMessageLabelRepository {
	apply(input: CreateMessageLabelInput): Promise<MessageLabelItem>;
	remove(messageId: string, labelId: string): Promise<void>;
	listByMessageId(messageId: string): Promise<MessageLabelItem[]>;
	listByLabelId(
		accountConfigId: string,
		labelId: string,
	): Promise<MessageLabelItem[]>;
}
