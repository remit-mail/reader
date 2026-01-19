import { z } from "zod";

export const paginationSchema = z.object({
	page: z.number().int().positive().default(1),
	limit: z.number().int().min(10).max(100).default(50),
	cursor: z.string().optional(),
});

export const mailListSearchSchema = z.object({
	filter: z.enum(["all", "unread", "starred", "attachments"]).default("all"),
	sort: z.enum(["date", "sender", "subject"]).default("date"),
	order: z.enum(["asc", "desc"]).default("desc"),

	...paginationSchema.shape,

	dialog: z.enum(["compose", "move", "delete", "settings"]).optional(),

	selectedThreadId: z.string().optional(),
	selectedMessageId: z.string().optional(),

	q: z.string().optional(),
});

export type MailListSearch = z.infer<typeof mailListSearchSchema>;

export const threadViewSearchSchema = z.object({
	expandedMessageId: z.string().optional(),
	expandAll: z.boolean().default(false),

	dialog: z.enum(["reply", "reply-all", "forward", "delete"]).optional(),
	replyToMessageId: z.string().optional(),
});

export type ThreadViewSearch = z.infer<typeof threadViewSearchSchema>;
