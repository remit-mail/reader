import type {
	MessagePlacementMoveItem,
	PutMessagePlacementMoveInput,
} from "../types.js";

export interface IMessagePlacementMoveRepository {
	put(input: PutMessagePlacementMoveInput): Promise<MessagePlacementMoveItem>;
	find(messageId: string): Promise<MessagePlacementMoveItem | null>;
	updateState(
		messageId: string,
		state: MessagePlacementMoveItem["state"],
	): Promise<MessagePlacementMoveItem>;
	delete(messageId: string): Promise<void>;
	listByAccountId(accountId: string): Promise<MessagePlacementMoveItem[]>;
}
