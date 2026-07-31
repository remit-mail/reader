export const messageKeys = {
	all: ["messages"] as const,

	detail: (messageId: string) =>
		[...messageKeys.all, "detail", messageId] as const,

	body: (messageId: string) =>
		[...messageKeys.detail(messageId), "body"] as const,
};
