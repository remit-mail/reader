export const threadKeys = {
	all: ["threads"] as const,

	lists: () => [...threadKeys.all, "list"] as const,

	list: (
		mailboxId: string,
		filters?: { filter?: string; page?: number; cursor?: string },
	) => [...threadKeys.lists(), mailboxId, filters] as const,

	details: () => [...threadKeys.all, "detail"] as const,

	detail: (threadId: string) => [...threadKeys.details(), threadId] as const,

	messages: (threadId: string) =>
		[...threadKeys.detail(threadId), "messages"] as const,
};

export const mailboxKeys = {
	all: ["mailboxes"] as const,

	lists: () => [...mailboxKeys.all, "list"] as const,

	list: (accountId: string) => [...mailboxKeys.lists(), accountId] as const,

	detail: (mailboxId: string) =>
		[...mailboxKeys.all, "detail", mailboxId] as const,
};

export const messageKeys = {
	all: ["messages"] as const,

	detail: (messageId: string) =>
		[...messageKeys.all, "detail", messageId] as const,

	body: (messageId: string) =>
		[...messageKeys.detail(messageId), "body"] as const,
};
