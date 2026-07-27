import type { CreateMessageLabelInput, MessageLabelItem } from "../types.js";

export interface IMessageLabelRepository {
	apply(input: CreateMessageLabelInput): Promise<MessageLabelItem>;
	remove(messageId: string, labelId: string): Promise<void>;
	listByMessageId(messageId: string): Promise<MessageLabelItem[]>;
	/**
	 * Batch-fetch every MessageLabel row across a page of messages in one query
	 * — the read-time enrichment a thread listing needs (issue #26), mirroring
	 * the one-BatchGet-per-page contract `enrichThreadRows` already holds for
	 * Message/Address.
	 */
	listByMessageIds(messageIds: string[]): Promise<MessageLabelItem[]>;
	listByLabelId(
		accountConfigId: string,
		labelId: string,
	): Promise<MessageLabelItem[]>;
	/**
	 * Delete every MessageLabel row for a label in one statement — the message
	 * side of a label delete's cascade (issue #26). A label delete cascades in
	 * both directions: this clears the applied-to-messages side, and the
	 * caller separately deletes any filter whose actionLabelId is this label.
	 */
	removeAllByLabelId(accountConfigId: string, labelId: string): Promise<void>;
}
