import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { BadRequestError, NotFoundError } from "@remit/remit-electrodb-service";
import { logger } from "@remit/remit-logger-lambda";
import type {
	AccountExportRequestResponse,
	CreateExportResponse,
	DeleteAccountConfigResponse,
	DeleteMeInput,
	VipSuggestionsResponse,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent, getSubFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import type { MeOperationIds, OperationHandler } from "../types.js";
import { toVipSuggestionEntry } from "./vip-suggestions.js";

const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

export const MeOperations: Record<
	MeOperationIds,
	OperationHandler<MeOperationIds>
> = {
	MeOperations_listVipSuggestions: async (
		_context: Context,
		...args: unknown[]
	): Promise<VipSuggestionsResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);

		const { address } = await getClient();
		const items = await address.listSuggestedVips({ accountConfigId });

		return { suggestions: items.map(toVipSuggestionEntry) };
	},
	MeOperations_deleteMe: async (
		_context: Context,
		...args: unknown[]
	): Promise<DeleteAccountConfigResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);

		const { confirmEmail } = JSON.parse(
			event.body ?? "{}",
		) as Partial<DeleteMeInput>;
		const callerEmail = event.requestContext?.authorizer?.claims?.email as
			| string
			| undefined;

		if (typeof confirmEmail !== "string" || confirmEmail.trim() === "") {
			throw new BadRequestError("confirmEmail is required");
		}

		if (!callerEmail) {
			throw new BadRequestError("Account email claim missing from token");
		}

		if (confirmEmail.toLowerCase() !== callerEmail.toLowerCase()) {
			throw new BadRequestError(
				"confirmEmail does not match your account email",
			);
		}

		const { accountConfig } = await getClient();

		try {
			await accountConfig.update(accountConfigId, {
				state: "deleting",
				deletedAt: Date.now(),
			});
		} catch (err: unknown) {
			// If already in "deleting" state, treat as idempotent
			if (
				err instanceof Error &&
				(err.name === "ConditionalCheckFailedException" ||
					err.message.includes("ConditionalCheckFailed"))
			) {
				return {
					statusCode: 202,
					message: "Account deletion already in progress",
				};
			}
			throw err;
		}

		const queueUrl = env.SQS_QUEUE_URL_ACCOUNT_FANOUT;

		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify({
					type: "AccountDelete",
					accountConfigId,
				}),
			}),
		);

		// biome-ignore lint/plugin/no-logger-info: account deletion is an audit-grade signal
		logger.info({ accountConfigId }, "Account deletion initiated");

		return {
			statusCode: 202,
			message: "Account deletion initiated",
		};
	},
	MeOperations_createExport: async (
		_context: Context,
		...args: unknown[]
	): Promise<CreateExportResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const userId = getSubFromEvent(event);

		if (!userId) {
			throw new Error(
				"Missing Cognito `sub`: cannot attribute an export request to a user",
			);
		}

		const { accountExportRequest } = await getClient();
		const exportRequest = await accountExportRequest.create({
			accountConfigId,
			userId,
			state: "Pending",
		});

		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
				MessageBody: JSON.stringify({
					type: "AccountExport",
					accountConfigId,
					accountExportRequestId: exportRequest.accountExportRequestId,
				}),
			}),
		);

		// biome-ignore lint/plugin/no-logger-info: account export is an audit-grade signal
		logger.info(
			{
				accountConfigId,
				accountExportRequestId: exportRequest.accountExportRequestId,
			},
			"Account export initiated",
		);

		return {
			statusCode: 202,
			exportId: exportRequest.accountExportRequestId,
		};
	},
	MeOperations_getExport: async (
		context: Context,
		...args: unknown[]
	): Promise<AccountExportRequestResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const exportId = context.request.params.exportId as string;

		const { accountExportRequest, storage } = await getClient();
		const exportRequest = await accountExportRequest.get(exportId);

		if (exportRequest.accountConfigId !== accountConfigId) {
			throw new NotFoundError(`Export not found: ${exportId}`);
		}

		const downloadUrl =
			exportRequest.state === "Ready" && exportRequest.objectKey
				? await storage.getPresignedDownloadUrl(
						exportRequest.objectKey,
						DOWNLOAD_URL_TTL_SECONDS,
					)
				: undefined;

		return {
			accountExportRequestId: exportRequest.accountExportRequestId,
			accountConfigId: exportRequest.accountConfigId,
			userId: exportRequest.userId,
			state: exportRequest.state,
			createdAt: exportRequest.createdAt,
			updatedAt: exportRequest.updatedAt,
			objectKey: exportRequest.objectKey,
			downloadUrl,
			expiresAt: exportRequest.expiresAt,
			errorMessage: exportRequest.errorMessage,
		};
	},
};
