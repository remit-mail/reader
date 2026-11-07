import type {
	CreatePasswordResetInput,
	PasswordResetResponse,
	PeopleListResponse,
	Person,
	SignOutPersonInput,
	StepUpInput,
	StepUpResponse,
	UpdatePersonInput,
} from "@remit/api-openapi-types";
import type {
	GuardRefusal,
	PeopleDirectory,
	PeopleOutcome,
	PeopleRefusal,
} from "@remit/auth-service/people";
import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getPeopleDirectory } from "../service/people-directory.js";
import type {
	HandlerContext,
	OperationHandler,
	PeopleOperationIds,
} from "../types.js";

const CLIENT_IP_HEADER = "x-remit-client-ip";

const refuse = (
	statusCode: number,
	code: string,
	message: string,
): APIGatewayProxyResult =>
	({ statusCode, body: { code, message } }) as unknown as APIGatewayProxyResult;

const REFUSALS: Record<PeopleRefusal, [number, string]> = {
	caller_disabled: [403, "Your account is disabled."],
	not_found: [404, "Not found"],
	step_up_required: [403, "Confirm your password again."],
	wrong_password: [403, "That password is not right."],
	step_up_locked: [429, "Too many wrong passwords. Try again in 15 minutes."],
	cannot_disable_self: [409, "You cannot disable your own account."],
};

const refusalOf = (refusal: PeopleRefusal): APIGatewayProxyResult => {
	const [statusCode, message] = REFUSALS[refusal];
	return refuse(statusCode, refusal, message);
};

const headerOf = (context: Context, name: string): string | undefined => {
	const headers = context.request.headers;
	const key = Object.keys(headers).find((each) => each.toLowerCase() === name);
	const value = key === undefined ? undefined : headers[key];
	return typeof value === "string" ? value : undefined;
};

interface Guarded {
	directory: PeopleDirectory;
	callerId: string;
	clientIp: string;
}

/**
 * The guards every People operation runs before any read or write. The
 * surface does not exist (404) while anyone can sign up, since anyone could
 * then make themselves an operator; the kill switch refuses it; an unsafe
 * request from an origin this instance does not serve is refused. The caller's
 * own row is checked inside the directory, in the transaction that acts.
 */
const guard = (
	context: Context,
	ctx: HandlerContext,
	targetId: string,
	unsafe: boolean,
): Guarded | APIGatewayProxyResult => {
	const directory = getPeopleDirectory();
	const { auth } = ctx.config;
	if (
		auth.mode !== "BetterAuthJwt" ||
		auth.selfSignUp === "Enabled" ||
		!directory
	) {
		return refusalOf("not_found");
	}
	const request = {
		directory,
		callerId: ctx.identity.sub,
		clientIp: headerOf(context, CLIENT_IP_HEADER) ?? "unknown",
	};
	const refuseAudited = (
		outcome: GuardRefusal,
		code: string,
		message: string,
	): APIGatewayProxyResult => {
		directory.recordRefusal({ ...request, targetId, outcome });
		return refuse(403, code, message);
	};
	if (auth.signIn === "Disabled") {
		return refuseAudited(
			"RefusedSignInOff",
			"sign_in_disabled",
			"Sign-in is turned off on this server.",
		);
	}
	const origin = headerOf(context, "origin");
	if (
		unsafe &&
		origin !== undefined &&
		!ctx.config.corsAllowedOrigins.includes(origin)
	) {
		return refuseAudited(
			"RefusedForeignOrigin",
			"foreign_origin",
			"This request came from a page this server does not serve.",
		);
	}
	return request;
};

const isGuarded = (value: Guarded | APIGatewayProxyResult): value is Guarded =>
	"directory" in value;

const answer = <T>(outcome: PeopleOutcome<T>): T | APIGatewayProxyResult =>
	outcome.ok ? outcome.value : refusalOf(outcome.refusal);

const targetOf = (context: Context): string =>
	(context.request.params as { userId: string }).userId;

export const PeopleOperations: Record<
	PeopleOperationIds,
	OperationHandler<PeopleOperationIds>
> = {
	PeopleOperations_listPeople: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<PeopleListResponse | APIGatewayProxyResult> => {
		const guarded = guard(context, ctx, "all", false);
		if (!isGuarded(guarded)) return guarded;
		const listed = answer(await guarded.directory.listPeople(guarded));
		return Array.isArray(listed) ? { people: listed } : listed;
	},

	PeopleOperations_createStepUp: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<StepUpResponse | APIGatewayProxyResult> => {
		const body = context.request.requestBody as StepUpInput;
		const guarded = guard(context, ctx, body.userId, true);
		if (!isGuarded(guarded)) return guarded;
		return answer(
			await guarded.directory.createStepUp({
				...guarded,
				targetId: body.userId,
				action: body.action,
				password: body.password,
			}),
		);
	},

	PeopleOperations_signOutPerson: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<Person | APIGatewayProxyResult> => {
		const targetId = targetOf(context);
		const guarded = guard(context, ctx, targetId, true);
		if (!isGuarded(guarded)) return guarded;
		const { stepUpToken } = context.request.requestBody as SignOutPersonInput;
		return answer(
			await guarded.directory.signOutPerson({
				...guarded,
				targetId,
				stepUpToken,
			}),
		);
	},

	PeopleOperations_updatePerson: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<Person | APIGatewayProxyResult> => {
		const targetId = targetOf(context);
		const guarded = guard(context, ctx, targetId, true);
		if (!isGuarded(guarded)) return guarded;
		const { status, stepUpToken } = context.request
			.requestBody as UpdatePersonInput;
		return answer(
			await guarded.directory.updatePerson({
				...guarded,
				targetId,
				stepUpToken,
				status,
			}),
		);
	},

	PeopleOperations_createPasswordReset: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<PasswordResetResponse | APIGatewayProxyResult> => {
		const targetId = targetOf(context);
		const guarded = guard(context, ctx, targetId, true);
		if (!isGuarded(guarded)) return guarded;
		const { stepUpToken } = context.request
			.requestBody as CreatePasswordResetInput;
		return answer(
			await guarded.directory.createPasswordReset({
				...guarded,
				targetId,
				stepUpToken,
			}),
		);
	},
};
