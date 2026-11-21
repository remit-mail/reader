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
import {
	clearClassificationProviderFor,
	createExportFor,
	getSyncStatusFor,
	listQuarantineFor,
	listVipSuggestionsFor,
	readUserSettings,
	testClassificationProviderFor,
	triggerSyncFor,
	updateUserSettingsFor,
	userSettingsDepsOf,
} from "@remit/backend/mcp-account-operations";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { z } from "zod";
import type { McpDeps } from "./deps.js";
import { operationTool } from "./operation-tool.js";
import { asJson } from "./tool-result.js";

type OperationConfig = Parameters<
	(typeof handlers)["ConfigOperations_getConfig"]
>[1]["config"];
type OperationId = keyof typeof handlers;
type OperationContext = Parameters<
	(typeof handlers)["ConfigOperations_getConfig"]
>[0];

const operationConfig = {
	commit: "unknown",
	publicOrigin: "mcp",
	updateControlDir: "",
} as OperationConfig;

const accountIdSchema = TestConnectionInputSchema.shape.accountId.unwrap();

const operationError = (
	value: unknown,
): value is {
	statusCode: number;
	message: string;
} =>
	typeof value === "object" &&
	value !== null &&
	"statusCode" in value &&
	typeof value.statusCode === "number" &&
	value.statusCode >= 400 &&
	"message" in value &&
	typeof value.message === "string";

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
	const result = await handler(
		{ request: { requestBody, params } } as OperationContext,
		{
			client,
			identity: {
				kind: "user",
				accountConfigId: deriveAccountConfigId(userId),
				sub: userId,
				email: userId,
			},
			config: operationConfig,
		},
	);
	if (operationError(result)) throw new Error(result.message);
	return result;
};

const testConnection = async (
	client: RemitClient,
	userId: string,
	input: z.infer<typeof TestConnectionInputSchema>,
) => {
	if (input.accountId !== undefined && input.password === undefined) {
		const account = await client.account.get(input.accountId);
		if (account.accountConfigId !== deriveAccountConfigId(userId)) {
			throw new Error(`Account not found: ${input.accountId}`);
		}
		if (account.authType === "oauthMicrosoft") {
			const scope = await client.createConnectionScope(account.accountId);
			try {
				await scope.getConnection();
				return { imapSuccess: true };
			} catch (error) {
				return {
					imapSuccess: false,
					imapError: error instanceof Error ? error.message : String(error),
				};
			} finally {
				await scope.disconnect();
			}
		}
	}
	return callOperation(
		client,
		userId,
		"AccountOperations_testConnection",
		input,
	);
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
		operationTool(server, [operationId], name).registerTool(
			name,
			{ description },
			async () => asJson(await callOperation(deps.client, userId, operationId)),
		);

	operationTool(
		server,
		["UserSettingsOperations_getUserSettings"],
		"get_user_settings",
	).registerTool(
		"get_user_settings",
		{
			description:
				"Read your settings, including classification and spam settings.",
		},
		async () =>
			asJson(
				await readUserSettings(
					userSettingsDepsOf(deps.client),
					deriveAccountConfigId(userId),
				),
			),
	);
	operationTool(
		server,
		["UserSettingsOperations_updateUserSettings"],
		"update_user_settings",
	).registerTool(
		"update_user_settings",
		{
			description: "Change your settings and return their current values.",
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
	operationTool(
		server,
		["UserSettingsOperations_clearClassificationProvider"],
		"clear_classification_provider",
	).registerTool(
		"clear_classification_provider",
		{
			description:
				"Delete the saved classification provider, key, and classification settings.",
		},
		async () =>
			asJson(
				await clearClassificationProviderFor(
					userSettingsDepsOf(deps.client),
					deriveAccountConfigId(userId),
				),
			),
	);
	operationTool(
		server,
		["UserSettingsOperations_testClassificationProvider"],
		"test_classification_provider",
	).registerTool(
		"test_classification_provider",
		{
			description:
				"Test classification settings against a built-in sample message without saving them.",
			inputSchema: ClassificationTestInputSchema.shape,
		},
		async (input) => {
			const result = await testClassificationProviderFor(
				deps.client,
				deriveAccountConfigId(userId),
				input,
			);
			if (!result.ok) throw new Error(result.error.message);
			return asJson(result.value);
		},
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
	operationTool(
		server,
		["ConfigOperations_importConfig"],
		"import_config",
	).registerTool(
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

	operationTool(
		server,
		["AccountOperations_createAccount"],
		"create_account",
	).registerTool(
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
	operationTool(
		server,
		["AccountOperations_testConnection"],
		"test_connection",
	).registerTool(
		"test_connection",
		{
			description:
				"Test an IMAP and optional SMTP connection without saving it.",
			inputSchema: TestConnectionInputSchema.shape,
		},
		async (input) => asJson(await testConnection(deps.client, userId, input)),
	);
	operationTool(
		server,
		["AccountDetailOperations_updateAccount"],
		"update_account",
	).registerTool(
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
		operationTool(server, [operationId], name).registerTool(
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
	operationTool(
		server,
		["SyncOperations_triggerSync"],
		"trigger_sync",
	).registerTool(
		"trigger_sync",
		{
			description: "Request an immediate sync for an account.",
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
	operationTool(
		server,
		["SyncOperations_getSyncStatus"],
		"get_sync_status",
	).registerTool(
		"get_sync_status",
		{
			description: "Get account and mailbox sync progress.",
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

	operationTool(
		server,
		["MeOperations_listVipSuggestions"],
		"list_vip_suggestions",
	).registerTool(
		"list_vip_suggestions",
		{ description: "List frequent correspondents that are not yet VIPs." },
		async () =>
			asJson(
				await listVipSuggestionsFor(deps.client, deriveAccountConfigId(userId)),
			),
	);
	operationTool(
		server,
		["MeOperations_createExport"],
		"create_export",
	).registerTool(
		"create_export",
		{ description: "Request an export of all account data." },
		async () =>
			asJson(
				await createExportFor(
					deps.client,
					deriveAccountConfigId(userId),
					userId,
				),
			),
	);
	operationTool(
		server,
		["MeOperations_listQuarantine"],
		"list_quarantine",
	).registerTool(
		"list_quarantine",
		{
			description:
				"List messages and warnings the sync path could not process.",
		},
		async () =>
			asJson(
				await listQuarantineFor(deps.client, deriveAccountConfigId(userId)),
			),
	);
};
