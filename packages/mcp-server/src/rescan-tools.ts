import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ownedAccount, RESCAN_LIMIT } from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { asJson, notFoundRefusal, refused } from "./tool-result.js";

const RESCAN_WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const notFound = notFoundRefusal("Use an accountId from list_mailboxes.");

export const registerRescanTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"rescan_messages",
		{
			description: `Check up to ${RESCAN_LIMIT} messages of one account again with the category classifier and the spam check, and return each verdict. Sets a category only on uncategorized mail and never labels a message the owner marked Not spam. Moves nothing unless move is true. Each message lands in successful or failed; retry only the failed ids marked retryable. To rescan a folder, page through list_threads or search_threads and send ${RESCAN_LIMIT} ids per call.`,
			inputSchema: {
				accountId: z
					.string()
					.min(1)
					.describe("The account the messages belong to, from list_mailboxes"),
				messageIds: z
					.array(z.string().min(1))
					.min(1)
					.max(RESCAN_LIMIT)
					.describe("Messages from list_threads, search_threads or get_thread"),
				move: z
					.boolean()
					.default(false)
					.describe("Also move a message the verdict sends to Junk"),
			},
			annotations: RESCAN_WRITE,
		},
		async ({ accountId, messageIds, move }) => {
			const owned = await deps.account
				.get(accountId)
				.then((account) => ownedAccount(account, accountConfigId, "act"))
				.catch(notFound);
			if (!owned.ok) return refused(owned.refusal);
			return asJson(
				await deps.rescan.rescan(
					{ accountId, accountConfigId },
					{ messageIds, move },
				),
			);
		},
	);
};
