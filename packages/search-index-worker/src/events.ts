export type IndexEvent =
	| {
			type: "upsert";
			messageId: string;
			accountId: string;
			accountConfigId: string;
			mailboxIds: string[];
			isNewMessage?: boolean;
	  }
	| { type: "delete"; messageId: string };

export type UpsertEvent = Extract<IndexEvent, { type: "upsert" }>;
export type DeleteEvent = Extract<IndexEvent, { type: "delete" }>;
