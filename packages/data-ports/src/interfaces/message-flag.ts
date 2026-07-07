import type { CreateMessageFlagInput, MessageFlagItem } from "../types.js";

export interface IMessageFlagRepository {
	create(input: CreateMessageFlagInput): Promise<MessageFlagItem>;
	get(messageFlagId: string): Promise<MessageFlagItem>;
	get(messageFlagIds: string[]): Promise<MessageFlagItem[]>;
	delete(messageFlagId: string): Promise<void>;
	deleteMany(messageFlagIds: string[]): Promise<void>;
	getFlags(messageId: string): Promise<MessageFlagItem[]>;
	hasFlag(messageId: string, flagName: string): Promise<boolean>;
	addFlag(messageId: string, flagName: string): Promise<MessageFlagItem>;
	removeFlag(messageId: string, flagName: string): Promise<void>;
	addFlags(messageId: string, flagNames: string[]): Promise<void>;
	removeFlags(messageId: string, flagNames: string[]): Promise<void>;
}
