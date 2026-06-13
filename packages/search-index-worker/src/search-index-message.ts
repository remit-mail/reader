export type SearchIndexMessage = {
	eventName: "INSERT" | "MODIFY" | "REMOVE";
	entity: "Message";
	eventID: string;
	eventTimestamp: number;
	accountId: string;
	keys: { pk: string; sk: string };
	messageId: string;
};
