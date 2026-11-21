import type {
	AccountExportRequestResponse,
	CreateExportResponse,
	DeleteAccountConfigResponse,
	DeleteMeInput,
	QuarantineListResponse,
	VipSuggestionsResponse,
} from "@remit/api-openapi-types";
import { BadRequestError, NotFoundError } from "@remit/data-ports/errors";
import { logger } from "@remit/logger";
import type { Context } from "openapi-backend";
import {
	createExportFor,
	listQuarantineFor,
	listVipSuggestionsFor,
} from "../service/me-operations.js";
import type { QueueName } from "../service/queues.js";
import type {
	HandlerContext,
	MeOperationIds,
	OperationHandler,
} from "../types.js";

const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

export const MeOperations = {
	MeOperations_listVipSuggestions: async (
		_context: Context,
		ctx: HandlerContext,
	): Promise<VipSuggestionsResponse> =>
		listVipSuggestionsFor(ctx.client, ctx.identity.accountConfigId),
	MeOperations_listQuarantine: async (
		_context: Context,
		ctx: HandlerContext,
	): Promise<QuarantineListResponse> =>
		listQuarantineFor(ctx.client, ctx.identity.accountConfigId),
	MeOperations_deleteMe: async (
		context: Context,
		ctx: HandlerContext<"accountFanout">,
	): Promise<DeleteAccountConfigResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;

		const { confirmEmail } = context.request
			.requestBody as Partial<DeleteMeInput>;
		const callerEmail = ctx.identity.email;

		if (typeof confirmEmail !== "string" || confirmEmail.trim() === "") {
			throw new BadRequestError("confirmEmail is required");
		}

		if (confirmEmail.toLowerCase() !== callerEmail.toLowerCase()) {
			throw new BadRequestError(
				"confirmEmail does not match your account email",
			);
		}

		const { accountConfig } = ctx.client;

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

		await ctx.client.queues.accountFanout.send({
			body: {
				type: "AccountDelete",
				accountConfigId,
				userId: ctx.identity.sub,
			},
		});

		// biome-ignore lint/plugin/no-logger-info: account deletion is an audit-grade signal
		logger.info({ accountConfigId }, "Account deletion initiated");

		return {
			statusCode: 202,
			message: "Account deletion initiated",
		};
	},
	MeOperations_createExport: async (
		_context: Context,
		ctx: HandlerContext<"accountFanout">,
	): Promise<CreateExportResponse> =>
		createExportFor(ctx.client, ctx.identity.accountConfigId, ctx.identity.sub),
	MeOperations_getExport: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<AccountExportRequestResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const exportId = context.request.params.exportId as string;

		const { accountExportRequest, storage } = ctx.client;
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
} satisfies Record<MeOperationIds, OperationHandler<MeOperationIds, QueueName>>;
