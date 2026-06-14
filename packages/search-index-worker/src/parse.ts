import { searchIndexMessageSchema } from "@remit/search-service";

export type ParsedQueueMessage =
	| {
			kind: "upsert";
			accountId: string;
			messageId: string;
			eventTimestamp: number;
	  }
	| { kind: "delete"; messageId: string };

export const parseQueueMessage = (body: string): ParsedQueueMessage => {
	const parsed = searchIndexMessageSchema.parse(JSON.parse(body));

	if (parsed.eventName === "REMOVE") {
		return { kind: "delete", messageId: parsed.messageId };
	}
	return {
		kind: "upsert",
		accountId: parsed.accountId,
		messageId: parsed.messageId,
		eventTimestamp: parsed.eventTimestamp,
	};
};
