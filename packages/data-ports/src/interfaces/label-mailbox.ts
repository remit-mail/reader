import type { LabelMailboxItem, PutLabelMailboxInput } from "../types.js";

export interface ILabelMailboxRepository {
	put(input: PutLabelMailboxInput): Promise<LabelMailboxItem>;
	get(labelId: string, accountId: string): Promise<LabelMailboxItem | null>;
	listByAccount(accountId: string): Promise<LabelMailboxItem[]>;
	listByLabel(labelId: string): Promise<LabelMailboxItem[]>;
}
