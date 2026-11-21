import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type ClassificationDefaultOperationsGetClassificationDefaultData,
	classificationDefaultOperationsDeleteClassificationDefault,
	classificationDefaultOperationsGetClassificationDefault,
	classificationDefaultOperationsPutClassificationDefault,
	type Options,
	peopleOperationsInvitePerson,
	peopleOperationsListAudit,
	peopleOperationsListPeople,
	peopleOperationsResetPersonFactors,
	peopleOperationsRevokeInvite,
	peopleOperationsSignOutPerson,
	peopleOperationsUpdatePerson,
	personSettingsOperationsClearPersonClassificationProvider,
	personSettingsOperationsGetPersonSettings,
	personSettingsOperationsUpdatePersonSettings,
} from "@remit/api-http-client";
import {
	InvitePersonInputSchema,
	PersonSchema,
	PutClassificationDefaultInputSchema,
	UpdatePersonInputSchema,
	UpdateUserSettingsInputSchema,
} from "@remit/api-zod-schemas";
import { asJson } from "./tool-result.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
} as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;
const userId = PersonSchema.shape.userId;
const asApiJson = (result: { data: unknown }) => asJson(result.data);

export type OperatorClient = NonNullable<
	Options<ClassificationDefaultOperationsGetClassificationDefaultData>["client"]
>;

export const registerOperatorTools = (
	server: McpServer,
	client: OperatorClient,
): void => {
	server.registerTool(
		"get_classification_default",
		{
			description:
				"Read the deployment classification default without its provider key.",
			annotations: READ_ONLY,
		},
		async () =>
			asApiJson(
				await classificationDefaultOperationsGetClassificationDefault({
					client,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"set_classification_default",
		{
			description:
				"Replace the deployment classification default. An empty API key keeps the existing key.",
			annotations: WRITE,
			inputSchema: PutClassificationDefaultInputSchema.shape,
		},
		async (body) =>
			asApiJson(
				await classificationDefaultOperationsPutClassificationDefault({
					client,
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"clear_classification_default",
		{
			description:
				"Remove the operator deployment classification default and fall back to deployment configuration.",
			annotations: DESTRUCTIVE,
		},
		async () =>
			asApiJson(
				await classificationDefaultOperationsDeleteClassificationDefault({
					client,
					throwOnError: true,
				}),
			),
	);

	server.registerTool(
		"get_tenant_settings",
		{
			description:
				"Read a person's settings without their classification provider key.",
			annotations: READ_ONLY,
			inputSchema: { userId },
		},
		async ({ userId }) =>
			asApiJson(
				await personSettingsOperationsGetPersonSettings({
					client,
					path: { userId },
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"update_tenant_settings",
		{
			description:
				"Change a person's settings and return their current values.",
			annotations: WRITE,
			inputSchema: { userId, ...UpdateUserSettingsInputSchema.shape },
		},
		async ({ userId, ...body }) =>
			asApiJson(
				await personSettingsOperationsUpdatePersonSettings({
					client,
					path: { userId },
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"clear_tenant_classification",
		{
			description:
				"Delete a person's saved classification provider, key, and classification settings.",
			annotations: DESTRUCTIVE,
			inputSchema: { userId },
		},
		async ({ userId }) =>
			asApiJson(
				await personSettingsOperationsClearPersonClassificationProvider({
					client,
					path: { userId },
					throwOnError: true,
				}),
			),
	);

	server.registerTool(
		"list_people",
		{
			description: "List everyone who signs in to this remit server.",
			annotations: READ_ONLY,
		},
		async () =>
			asApiJson(
				await peopleOperationsListPeople({ client, throwOnError: true }),
			),
	);
	server.registerTool(
		"invite_person",
		{
			description: "Invite an email address to create an account.",
			annotations: WRITE,
			inputSchema: InvitePersonInputSchema.shape,
		},
		async (body) =>
			asApiJson(
				await peopleOperationsInvitePerson({
					client,
					body,
					throwOnError: true,
				}),
			),
	);
	server.registerTool(
		"revoke_invite",
		{
			description: "Revoke the open invite for an email address.",
			annotations: DESTRUCTIVE,
			inputSchema: InvitePersonInputSchema.shape,
		},
		async ({ email }) =>
			asApiJson(
				await peopleOperationsRevokeInvite({
					client,
					path: { email },
					throwOnError: true,
				}),
			),
	);

	const personStatusTool = (
		name: "disable_person" | "enable_person",
		status: "Disabled" | "Active",
		description: string,
	) =>
		server.registerTool(
			name,
			{ description, annotations: WRITE, inputSchema: { userId } },
			async ({ userId }) =>
				asApiJson(
					await peopleOperationsUpdatePerson({
						client,
						path: { userId },
						body: UpdatePersonInputSchema.parse({ status }),
						throwOnError: true,
					}),
				),
		);
	personStatusTool("disable_person", "Disabled", "Disable a person.");
	personStatusTool("enable_person", "Active", "Enable a person.");

	const personActionTool = (
		name: "sign_out_person" | "reset_person_factors",
		description: string,
		action: (options: {
			client: OperatorClient;
			path: { userId: string };
			throwOnError: true;
		}) => Promise<{ data: unknown }>,
	) =>
		server.registerTool(
			name,
			{ description, annotations: DESTRUCTIVE, inputSchema: { userId } },
			async ({ userId }) =>
				asApiJson(
					await action({ client, path: { userId }, throwOnError: true }),
				),
		);
	personActionTool(
		"sign_out_person",
		"Sign a person out of every browser session and MCP connection.",
		peopleOperationsSignOutPerson,
	);
	personActionTool(
		"reset_person_factors",
		"Remove every sign-in factor from a person and revoke their sessions.",
		peopleOperationsResetPersonFactors,
	);

	server.registerTool(
		"list_audit",
		{
			description: "List retained identity audit events, newest first.",
			annotations: READ_ONLY,
		},
		async () =>
			asApiJson(
				await peopleOperationsListAudit({ client, throwOnError: true }),
			),
	);
};
