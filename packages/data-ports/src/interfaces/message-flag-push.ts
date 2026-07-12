import type { MessageFlagPushItem, PutMessageFlagPushInput } from "../types.js";

export interface IMessageFlagPushRepository {
	put(input: PutMessageFlagPushInput): Promise<MessageFlagPushItem>;
	find(
		messageId: string,
		flagName: string,
	): Promise<MessageFlagPushItem | null>;
	updateState(
		messageId: string,
		flagName: string,
		state: MessageFlagPushItem["state"],
	): Promise<MessageFlagPushItem>;
	delete(messageId: string, flagName: string): Promise<void>;
	listByAccountId(accountId: string): Promise<MessageFlagPushItem[]>;
	listByMailboxId(mailboxId: string): Promise<MessageFlagPushItem[]>;
}
