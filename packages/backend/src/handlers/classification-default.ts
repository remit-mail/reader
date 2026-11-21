import type {
	ClassificationDefaultResponse,
	PutClassificationDefaultInput,
} from "@remit/api-openapi-types";
import {
	type ClassificationDeploymentDefault,
	DEFAULT_CLASSIFICATION_DAILY_LIMIT,
} from "@remit/data-ports/classification-presets";
import { BadRequestError } from "@remit/data-ports/errors";
import type { Context } from "openapi-backend";
import { requireOperator } from "../auth.js";
import { parseClassificationDefault } from "../config/classification-default.js";
import type {
	ClassificationDefaultOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";
import { requireOperator } from "./operator.js";

const responseOf = (
	value: ClassificationDeploymentDefault,
	source: "Config" | "Operator",
): ClassificationDefaultResponse =>
	value.state === "Configured"
		? {
				presetId: value.presetId,
				model: value.model,
				baseUrl: value.baseUrl,
				enabled: value.enabled,
				dailyLimit: value.dailyLimit,
				hasKey: value.apiKey !== "",
				source,
			}
		: {
				presetId: null,
				model: null,
				baseUrl: null,
				enabled: false,
				dailyLimit: DEFAULT_CLASSIFICATION_DAILY_LIMIT,
				hasKey: false,
				source,
			};

const read = async (
	ctx: HandlerContext,
): Promise<ClassificationDefaultResponse> => {
	const setting = await ctx.client.classificationDefault.get();
	return responseOf(setting.value, setting.source);
};

export const ClassificationDefaultOperations: Record<
	ClassificationDefaultOperationIds,
	OperationHandler<ClassificationDefaultOperationIds>
> = {
	ClassificationDefaultOperations_getClassificationDefault: async (
		_context: Context,
		ctx: HandlerContext,
	): Promise<ClassificationDefaultResponse> => {
		requireOperator(ctx);
		return read(ctx);
	},

	ClassificationDefaultOperations_putClassificationDefault: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<ClassificationDefaultResponse> => {
		requireOperator(ctx);
		const input = context.request.requestBody as PutClassificationDefaultInput;
		const current = await ctx.client.classificationDefault.get();
		const parsed = parseClassificationDefault({
			...input,
			apiKey:
				input.apiKey === "" && current.value.state === "Configured"
					? current.value.apiKey
					: input.apiKey,
		});
		if (!parsed.ok) throw new BadRequestError(parsed.message);
		if (parsed.value.state !== "Configured") {
			throw new Error("A parsed classification default was not configured");
		}
		await ctx.client.classificationDefault.put(parsed.value);
		return responseOf(parsed.value, "Operator");
	},

	ClassificationDefaultOperations_deleteClassificationDefault: async (
		_context: Context,
		ctx: HandlerContext,
	): Promise<ClassificationDefaultResponse> => {
		requireOperator(ctx);
		await ctx.client.classificationDefault.delete();
		return read(ctx);
	},
};
