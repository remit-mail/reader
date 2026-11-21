import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	ClassificationTestInputSchema,
	CreateAccountInputSchema,
	ImportConfigInputSchema,
	TestConnectionInputSchema,
	UpdateAccountInputSchema,
	UpdateUserSettingsInputSchema,
} from "@remit/api-zod-schemas";
import {
	createAccountFor,
	deleteAccountFor,
	testConnectionFor,
	updateAccountFor,
} from "@remit/backend/account-operations";
import {
	exportConfigFor,
	getConfigFor,
	importConfigFor,
} from "@remit/backend/config-operations";
import {
	createExportFor,
	listQuarantineFor,
	listVipSuggestionsFor,
} from "@remit/backend/me-operations";
import {
	getSyncStatusFor,
	triggerSyncFor,
} from "@remit/backend/sync-operations";
import {
	clearClassificationProviderFor,
	readUserSettings,
	testClassificationProviderFor,
	updateUserSettingsFor,
	userSettingsDepsOf,
} from "@remit/backend/user-settings-operations";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { McpDeps } from "./deps.js";
import { asJson } from "./tool-result.js";

const accountIdSchema = TestConnectionInputSchema.shape.accountId.unwrap();
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
} as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;

export const registerAccountTools = (
	server: McpServer,
	deps: McpDeps,
	userId: string,
): void => {
	const accountConfigId = deriveAccountConfigId(userId);

	server.registerTool(
		"get_user_settings",
		{
			description:
				"Read your settings, including classification and spam settings.",
			annotations: READ_ONLY,
		},
		async () =>
			asJson(
				await readUserSettings(
					userSettingsDepsOf(deps.client),
					deriveAccountConfigId(userId),
				),
			),
	);
	server.registerTool(
		"update_user_settings",
		{
			description: "Change your settings and return their current values.",
			annotations: WRITE,
			inputSchema: UpdateUserSettingsInputSchema.shape,
		},
		async (input) => {
			const result = await updateUserSettingsFor(
				userSettingsDepsOf(deps.client),
				deriveAccountConfigId(userId),
				input,
			);
			if (!result.ok) throw new Error(result.error.message);
			return asJson(result.value);
		},
	);
	server.registerTool(
		"clear_classification_provider",
		{
			description:
				"Delete the saved classification provider, key, and classification settings.",
			annotations: DESTRUCTIVE,
		},
		async () =>
			asJson(
				await clearClassificationProviderFor(
					userSettingsDepsOf(deps.client),
					deriveAccountConfigId(userId),
				),
			),
	);
	server.registerTool(
		"test_classification_provider",
		{
			description:
				"Test classification settings against a built-in sample message without saving them.",
			annotations: READ_ONLY,
			inputSchema: ClassificationTestInputSchema.shape,
		},
		async (input) => {
			const result = await testClassificationProviderFor(
				deps.client,
				deriveAccountConfigId(userId),
				input.apiKey === "" ? { ...input, baseUrl: "" } : input,
			);
			if (!result.ok) throw new Error(result.error.message);
			return asJson(result.value);
		},
	);

	server.registerTool(
		"get_config",
		{
			description: "Get your accounts and configuration.",
			annotations: READ_ONLY,
		},
		async () =>
			asJson(
				await getConfigFor(deps.client, accountConfigId, deps.apiConfig.commit),
			),
	);
	server.registerTool(
		"export_config",
		{
			description: "Export your configuration without credentials.",
			annotations: READ_ONLY,
		},
		async () =>
			asJson(
				await exportConfigFor(deps.client, accountConfigId, {
					app: "reader",
					version: "unknown",
					exportedAt: new Date().toISOString(),
					instance: deps.apiConfig.publicOrigin,
				}),
			),
	);
	server.registerTool(
		"import_config",
		{
			description: "Validate or apply an exported configuration document.",
			annotations: WRITE,
			inputSchema: ImportConfigInputSchema.shape,
		},
		async (input) =>
			asJson(await importConfigFor(deps.client, accountConfigId, input)),
	);

	server.registerTool(
		"create_account",
		{
			description: "Create an email account.",
			annotations: WRITE,
			inputSchema: CreateAccountInputSchema.shape,
		},
		async (input) =>
			asJson(await createAccountFor(deps.client, accountConfigId, input)),
	);
	server.registerTool(
		"test_connection",
		{
			description:
				"Test an IMAP and optional SMTP connection without saving it.",
			annotations: READ_ONLY,
			inputSchema: TestConnectionInputSchema.shape,
		},
		async (input) =>
			asJson(
				await testConnectionFor(
					deps.client,
					accountConfigId,
					input,
					deps.apiConfig.msOAuth,
				),
			),
	);
	server.registerTool(
		"update_account",
		{
			description:
				"Change an email account and return its current configuration.",
			annotations: WRITE,
			inputSchema: {
				accountId: accountIdSchema,
				...UpdateAccountInputSchema.shape,
			},
		},
		async ({ accountId, ...input }) =>
			asJson(
				await updateAccountFor(deps.client, accountConfigId, accountId, input),
			),
	);
	server.registerTool(
		"delete_account",
		{
			description: "Delete an email account and its associated data.",
			annotations: DESTRUCTIVE,
			inputSchema: { accountId: accountIdSchema },
		},
		async ({ accountId }) =>
			asJson(await deleteAccountFor(deps.client, accountConfigId, accountId)),
	);
	server.registerTool(
		"trigger_sync",
		{
			description: "Request an immediate sync for an account.",
			annotations: WRITE,
			inputSchema: { accountId: accountIdSchema },
		},
		async ({ accountId }) =>
			asJson(
				await triggerSyncFor(
					deps.client,
					deriveAccountConfigId(userId),
					accountId,
				),
			),
	);
	server.registerTool(
		"get_sync_status",
		{
			description: "Get account and mailbox sync progress.",
			annotations: READ_ONLY,
			inputSchema: { accountId: accountIdSchema },
		},
		async ({ accountId }) =>
			asJson(
				await getSyncStatusFor(
					deps.client,
					deriveAccountConfigId(userId),
					accountId,
				),
			),
	);

	server.registerTool(
		"create_export",
		{
			description: "Request an export of all account data.",
			annotations: WRITE,
		},
		async () =>
			asJson(
				await createExportFor(
					deps.client,
					deriveAccountConfigId(userId),
					userId,
				),
			),
	);
};

export const registerAccountReadTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"list_vip_suggestions",
		{
			description: "List frequent correspondents that are not yet VIPs.",
			annotations: READ_ONLY,
		},
		async () =>
			asJson(await listVipSuggestionsFor(deps.client, accountConfigId)),
	);
	server.registerTool(
		"list_quarantine",
		{
			description:
				"List messages and warnings the sync path could not process.",
			annotations: READ_ONLY,
		},
		async () => asJson(await listQuarantineFor(deps.client, accountConfigId)),
	);
};
