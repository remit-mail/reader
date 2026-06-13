import { z } from "zod";

const legacyUpsertSchema = z.object({
	type: z.literal("upsert"),
	messageId: z.string().min(1),
	accountId: z.string().min(1),
	accountConfigId: z.string().min(1),
	mailboxIds: z.array(z.string()),
});

const legacyDeleteSchema = z.object({
	type: z.literal("delete"),
	messageId: z.string().min(1),
});

const searchIndexMessageSchema = z.object({
	eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
	entity: z.literal("Message"),
	eventID: z.string(),
	eventTimestamp: z.number(),
	accountId: z.string().min(1),
	keys: z.object({ pk: z.string(), sk: z.string() }),
	messageId: z.string().min(1),
});

const queueBodySchema = z.union([
	legacyUpsertSchema,
	legacyDeleteSchema,
	searchIndexMessageSchema,
]);

export type ParsedQueueMessage =
	| { kind: "upsert"; accountId: string; messageId: string }
	| { kind: "delete"; messageId: string };

export const parseQueueMessage = (body: string): ParsedQueueMessage => {
	const parsed = queueBodySchema.parse(JSON.parse(body));

	if ("type" in parsed) {
		if (parsed.type === "delete") {
			return { kind: "delete", messageId: parsed.messageId };
		}
		return {
			kind: "upsert",
			accountId: parsed.accountId,
			messageId: parsed.messageId,
		};
	}

	if (parsed.eventName === "REMOVE") {
		return { kind: "delete", messageId: parsed.messageId };
	}
	return {
		kind: "upsert",
		accountId: parsed.accountId,
		messageId: parsed.messageId,
	};
};
