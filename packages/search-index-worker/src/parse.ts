import { z } from "zod";

const searchIndexMessageSchema = z.object({
	eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
	entity: z.literal("Message"),
	eventID: z.string(),
	eventTimestamp: z.number(),
	accountId: z.string().min(1),
	keys: z.object({ pk: z.string(), sk: z.string() }),
	messageId: z.string().min(1),
});

export type ParsedQueueMessage =
	| { kind: "upsert"; accountId: string; messageId: string }
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
	};
};
