import type {
	InvitePersonInput,
	PasswordResetResponse,
	PeopleAuditResponse,
	PeopleListResponse,
	Person,
	PersonInviteResponse,
	StepUpInput,
	StepUpResponse,
	UpdatePersonInput,
} from "@remit/api-openapi-types";
import type {
	GuardRefusal,
	PeopleDirectory,
	PeopleOutcome,
	PeopleRefusal,
	TargetedRequest,
} from "@remit/auth-service/people";
import { PeopleErrorCode } from "@remit/domain-enums";
import type { Context } from "openapi-backend";
import { requireOperator } from "../auth.js";
import type {
	HandlerContext,
	OperationHandler,
	PeopleOperationIds,
} from "../types.js";

const CLIENT_IP_HEADER = "x-remit-client-ip";

interface Refusal {
	statusCode: number;
	body: { code: PeopleRefusal; message: string };
}

const REFUSALS: Record<PeopleRefusal, [number, string]> = {
	[PeopleErrorCode.SignInDisabled]: [
		403,
		"Sign-in is turned off on this server.",
	],
	[PeopleErrorCode.CallerDisabled]: [403, "Your account is disabled."],
	[PeopleErrorCode.ForeignOrigin]: [
		403,
		"This request came from a page this server does not serve.",
	],
	[PeopleErrorCode.StepUpRequired]: [403, "Confirm your password again."],
	[PeopleErrorCode.WrongPassword]: [403, "That password is not right."],
	[PeopleErrorCode.StepUpLocked]: [
		429,
		"Too many wrong passwords. Try again in 15 minutes.",
	],
	[PeopleErrorCode.CannotDisableSelf]: [
		409,
		"You cannot disable your own account.",
	],
	not_found: [404, "Not found"],
};

const refusalOf = (code: PeopleRefusal): Refusal => {
	const [statusCode, message] = REFUSALS[code];
	return { statusCode, body: { code, message } };
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
): Guarded | Refusal => {
	const directory = ctx.peopleDirectory;
	const { auth } = ctx.config;
	if (!directory) {
		return refusalOf("not_found");
	}
	if (auth.mode === "GatewayAuthorizer") requireOperator(ctx);
	else if (auth.selfSignUp === "Enabled") return refusalOf("not_found");
	const request = {
		directory,
		callerId: ctx.identity.sub,
		clientIp: headerOf(context, CLIENT_IP_HEADER) ?? "unknown",
	};
	const refuseAudited = (
		outcome: GuardRefusal,
		code: PeopleRefusal,
	): Refusal => {
		directory.recordRefusal({ ...request, targetId, outcome });
		return refusalOf(code);
	};
	if (auth.mode === "BetterAuthJwt" && auth.signIn === "Disabled") {
		return refuseAudited("RefusedSignInOff", PeopleErrorCode.SignInDisabled);
	}
	const origin = headerOf(context, "origin");
	if (
		unsafe &&
		origin !== undefined &&
		!ctx.config.corsAllowedOrigins.includes(origin)
	) {
		return refuseAudited("RefusedForeignOrigin", PeopleErrorCode.ForeignOrigin);
	}
	return request;
};

const isGuarded = (value: Guarded | Refusal): value is Guarded =>
	"directory" in value;

const answer = <T>(outcome: PeopleOutcome<T>): T | Refusal =>
	outcome.ok ? outcome.value : refusalOf(outcome.refusal);

const targetOf = (context: Context): string =>
	(context.request.params as { userId: string }).userId;

const targetedRequest = (
	guarded: Guarded,
	targetId: string,
	stepUpToken: string | null,
): TargetedRequest => ({
	callerId: guarded.callerId,
	clientIp: guarded.clientIp,
	targetId,
	stepUpToken,
});

export const PeopleOperations: Record<
	PeopleOperationIds,
	OperationHandler<PeopleOperationIds>
> = {
	PeopleOperations_listPeople: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<PeopleListResponse | Refusal> => {
		const guarded = guard(context, ctx, "all", false);
		if (!isGuarded(guarded)) return guarded;
		const listed = answer(await guarded.directory.listPeople(guarded));
		return Array.isArray(listed) ? { people: listed } : listed;
	},

	PeopleOperations_listAudit: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<PeopleAuditResponse | Refusal> => {
		requireOperator(ctx);
		const guarded = guard(context, ctx, "all", false);
		if (!isGuarded(guarded)) return guarded;
		const listed = answer(await guarded.directory.listAudit(guarded));
		return Array.isArray(listed) ? { events: listed } : listed;
	},

	PeopleOperations_invitePerson: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<PersonInviteResponse | Refusal> => {
		requireOperator(ctx);
		const { email } = context.request.requestBody as InvitePersonInput;
		const guarded = guard(context, ctx, email, true);
		if (!isGuarded(guarded)) return guarded;
		return answer(
			await guarded.directory.invitePerson({
				callerId: guarded.callerId,
				clientIp: guarded.clientIp,
				email,
			}),
		);
	},

	PeopleOperations_revokeInvite: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<PersonInviteResponse | Refusal> => {
		requireOperator(ctx);
		const { email } = context.request.params as { email: string };
		const guarded = guard(context, ctx, email, true);
		if (!isGuarded(guarded)) return guarded;
		return answer(
			await guarded.directory.revokeInvite({
				callerId: guarded.callerId,
				clientIp: guarded.clientIp,
				email,
			}),
		);
	},

	PeopleOperations_createStepUp: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<StepUpResponse | Refusal> => {
		if (ctx.config.auth.mode !== "BetterAuthJwt") return refusalOf("not_found");
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
	): Promise<Person | Refusal> => {
		const targetId = targetOf(context);
		const guarded = guard(context, ctx, targetId, true);
		if (!isGuarded(guarded)) return guarded;
		const stepUpToken = headerOf(context, "x-remit-step-up") ?? null;
		return answer(
			await guarded.directory.signOutPerson(
				targetedRequest(guarded, targetId, stepUpToken),
			),
		);
	},

	PeopleOperations_updatePerson: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<Person | Refusal> => {
		const targetId = targetOf(context);
		const guarded = guard(context, ctx, targetId, true);
		if (!isGuarded(guarded)) return guarded;
		const { status } = context.request.requestBody as UpdatePersonInput;
		const stepUpToken = headerOf(context, "x-remit-step-up") ?? null;
		return answer(
			await guarded.directory.updatePerson({
				...targetedRequest(guarded, targetId, stepUpToken),
				status,
			}),
		);
	},

	PeopleOperations_createPasswordReset: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<PasswordResetResponse | Refusal> => {
		const targetId = targetOf(context);
		const guarded = guard(context, ctx, targetId, true);
		if (!isGuarded(guarded)) return guarded;
		const stepUpToken = headerOf(context, "x-remit-step-up") ?? null;
		return answer(
			await guarded.directory.createPasswordReset(
				targetedRequest(guarded, targetId, stepUpToken),
			),
		);
	},

	PeopleOperations_resetPersonFactors: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<Person | Refusal> => {
		requireOperator(ctx);
		const targetId = targetOf(context);
		const guarded = guard(context, ctx, targetId, true);
		if (!isGuarded(guarded)) return guarded;
		return answer(
			await guarded.directory.resetPersonFactors({
				callerId: guarded.callerId,
				clientIp: guarded.clientIp,
				targetId,
			}),
		);
	},
};
