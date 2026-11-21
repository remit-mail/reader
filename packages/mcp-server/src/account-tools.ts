import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	ClassificationTestInputSchema,
	CreateAccountInputSchema,
	ImportConfigInputSchema,
	TestConnectionInputSchema,
	UpdateAccountInputSchema,
	UpdateUserSettingsInputSchema,
} from "@remit/api-zod-schemas";
import type { RemitClient } from "@remit/backend/client";
import { handlers } from "@remit/backend/handlers";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { McpDeps } from "./deps.js";
import { asJson } from "./tool-result.js";

type OperationId = keyof typeof handlers;

type OperationConfig = Parameters<
	(typeof handlers)["ConfigOperations_getConfig"]
>[1]["config"];
type OperationContext = Parameters<
	(typeof handlers)["ConfigOperations_getConfig"]
>[0];

const operationConfig = {
	commit: "unknown",
	publicOrigin: "mcp",
	updateControlDir: "",
} as OperationConfig;

const accountIdSchema = TestConnectionInputSchema.shape.accountId.unwrap();

const callOperation = async (
	client: RemitClient,
	userId: string,
	operationId: OperationId,
	requestBody?: unknown,
	params: Record<string, string> = {},
) => {
	const handler = handlers[operationId] as unknown as (
		context: OperationContext,
		caller: {
			client: RemitClient;
			identity: {
				kind: "user";
				accountConfigId: string;
				sub: string;
				email: string;
			};
			config: OperationConfig;
		},
	) => Promise<unknown>;
	return handler({ request: { requestBody, params } } as OperationContext, {
		client,
		identity: {
			kind: "user",
			accountConfigId: deriveAccountConfigId(userId),
			sub: userId,
			email: userId,
		},
		config: operationConfig,
	});
};

export const registerAccountTools = (
	server: McpServer,
	deps: McpDeps,
	userId: string,
): void => {
	const noInput = (
		name: string,
		description: string,
		operationId: OperationId,
	) =>
		server.registerTool(name, { description }, async () =>
			asJson(await callOperation(deps.client, userId, operationId)),
		);

	noInput(
		"get_user_settings",
		"Read your settings, including classification and spam settings.",
		"UserSettingsOperations_getUserSettings",
	);
	server.registerTool(
		"update_user_settings",
		{
			description: "Change your settings and return their current values.",
			inputSchema: UpdateUserSettingsInputSchema.shape,
		},
		async (input) =>
			asJson(
				await callOperation(
					deps.client,
					userId,
					"UserSettingsOperations_updateUserSettings",
					input,
				),
			),
	);
	noInput(
		"clear_classification_provider",
		"Delete the saved classification provider, key, and classification settings.",
		"UserSettingsOperations_clearClassificationProvider",
	);
	server.registerTool(
		"test_classification_provider",
		{
			description:
				"Test classification settings against a built-in sample message without saving them.",
			inputSchema: ClassificationTestInputSchema.shape,
		},
		async (input) =>
			asJson(
				await callOperation(
					deps.client,
					userId,
					"UserSettingsOperations_testClassificationProvider",
					input,
				),
			),
	);

	noInput(
		"get_config",
		"Get your accounts and configuration.",
		"ConfigOperations_getConfig",
	);
	noInput(
		"export_config",
		"Export your configuration without credentials.",
		"ConfigOperations_exportConfig",
	);
	server.registerTool(
		"import_config",
		{
			description: "Validate or apply an exported configuration document.",
			inputSchema: ImportConfigInputSchema.shape,
		},
		async (input) =>
			asJson(
				await callOperation(
					deps.client,
					userId,
					"ConfigOperations_importConfig",
					input,
				),
			),
	);

	server.registerTool(
		"create_account",
		{
			description: "Create an email account.",
			inputSchema: CreateAccountInputSchema.shape,
		},
		async (input) =>
			asJson(
				await callOperation(
					deps.client,
					userId,
					"AccountOperations_createAccount",
					input,
				),
			),
	);
	server.registerTool(
		"test_connection",
		{
			description:
				"Test an IMAP and optional SMTP connection without saving it.",
			inputSchema: TestConnectionInputSchema.shape,
		},
		async (input) =>
			asJson(
				await callOperation(
					deps.client,
					userId,
					"AccountOperations_testConnection",
					input,
				),
			),
	);
	server.registerTool(
		"update_account",
		{
			description:
				"Change an email account and return its current configuration.",
			inputSchema: {
				accountId: accountIdSchema,
				...UpdateAccountInputSchema.shape,
			},
		},
		async ({ accountId, ...input }) =>
			asJson(
				await callOperation(
					deps.client,
					userId,
					"AccountDetailOperations_updateAccount",
					input,
					{ accountId },
				),
			),
	);
	const accountIdTool = (
		name: string,
		description: string,
		operationId: OperationId,
	) =>
		server.registerTool(
			name,
			{ description, inputSchema: { accountId: accountIdSchema } },
			async ({ accountId }) =>
				asJson(
					await callOperation(deps.client, userId, operationId, undefined, {
						accountId,
					}),
				),
		);
	accountIdTool(
		"delete_account",
		"Delete an email account and its associated data.",
		"AccountDetailOperations_deleteAccount",
	);
	accountIdTool(
		"trigger_sync",
		"Request an immediate sync for an account.",
		"SyncOperations_triggerSync",
	);
	accountIdTool(
		"get_sync_status",
		"Get account and mailbox sync progress.",
		"SyncOperations_getSyncStatus",
	);

	noInput(
		"list_vip_suggestions",
		"List frequent correspondents that are not yet VIPs.",
		"MeOperations_listVipSuggestions",
	);
	noInput(
		"create_export",
		"Request an export of all account data.",
		"MeOperations_createExport",
	);
	noInput(
		"list_quarantine",
		"List messages and warnings the sync path could not process.",
		"MeOperations_listQuarantine",
	);
};
