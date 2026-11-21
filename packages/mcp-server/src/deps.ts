import type { RemitClient } from "@remit/backend/client";
import type { ApiConfig } from "@remit/backend/serve";
import type {
	MaterializeLogger,
	OrganizeJobLogger,
} from "@remit/mailbox-service";
import type { OperatorClient } from "./operator-tools.js";

export const FOLDER_SETTLE_TIMEOUT_MS = 20_000;
export const FOLDER_POLL_INTERVAL_MS = 500;
// Well inside the 60-second tool timeout MCP clients commonly apply.
export const MOVE_BATCH_BUDGET_MS = 20_000;

export interface FolderToolDeps {
	settleTimeoutMs: number;
	pollIntervalMs: number;
	sleep: (ms: number) => Promise<void>;
}

export interface MoveToolDeps {
	budgetMs: number;
	pollIntervalMs: number;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
}

export interface McpDeps {
	client: RemitClient;
	operatorClient: (userId: string) => OperatorClient;
	apiConfig: Pick<ApiConfig, "commit" | "msOAuth" | "publicOrigin">;
	logger: MaterializeLogger & OrganizeJobLogger;
	folders: FolderToolDeps;
	moves: MoveToolDeps;
}

export interface McpDepsExtras {
	apiConfig: McpDeps["apiConfig"];
	logger: MaterializeLogger & OrganizeJobLogger;
	operatorClient: (userId: string) => OperatorClient;
	settle: FolderToolDeps;
}

export const mcpDepsOf = (
	client: RemitClient,
	{ apiConfig, logger, operatorClient, settle }: McpDepsExtras,
): McpDeps => ({
	client,
	operatorClient,
	apiConfig,
	logger,
	folders: settle,
	moves: {
		budgetMs: MOVE_BATCH_BUDGET_MS,
		pollIntervalMs: settle.pollIntervalMs,
		sleep: settle.sleep,
		now: Date.now,
	},
});
