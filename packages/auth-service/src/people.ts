import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
	Person,
	PersonStatus,
	StepUpAction,
} from "@remit/api-openapi-types";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { PeopleErrorCode } from "@remit/domain-enums";
import { calendarFeedTokens } from "@remit/drizzle-sqlite-schema";
import { and, asc, count, eq, gt, lte, sql } from "drizzle-orm";
import type { Auth } from "./auth.js";
import {
	applySignInSwitch,
	findUser,
	HOST_CLIENT_IP,
	type IdentityStore,
	revokeUser,
	type UserRow,
} from "./identity-store.js";
import {
	auth_account,
	auth_session,
	auth_user,
	auth_verification,
	identity_audit_event,
	identity_step_up,
} from "./schema/auth-schema-sqlite.js";

export type { Person, PersonStatus, StepUpAction };

export interface StepUpGrant {
	stepUpToken: string;
	expiresAt: number;
}

export interface PasswordReset {
	person: Person;
	resetUrl: string;
	expiresAt: number;
}

export type PeopleErrorCodeValue =
	(typeof PeopleErrorCode)[keyof typeof PeopleErrorCode];

export type PeopleRefusal = PeopleErrorCodeValue | "not_found";

export interface Refused {
	ok: false;
	refusal: PeopleRefusal;
}

export type PeopleOutcome<T> = { ok: true; value: T } | Refused;

export interface PeopleRequest {
	callerId: string;
	clientIp: string;
}

export interface TargetedRequest extends PeopleRequest {
	targetId: string;
	stepUpToken: string;
}

export interface StepUpRequest extends PeopleRequest {
	targetId: string;
	action: StepUpAction;
	password: string;
}

export type GuardRefusal = "RefusedSignInOff" | "RefusedForeignOrigin";

export interface PeopleDirectory {
	listPeople(request: PeopleRequest): Promise<PeopleOutcome<Person[]>>;
	createStepUp(request: StepUpRequest): Promise<PeopleOutcome<StepUpGrant>>;
	signOutPerson(request: TargetedRequest): Promise<PeopleOutcome<Person>>;
	updatePerson(
		request: TargetedRequest & { status: PersonStatus },
	): Promise<PeopleOutcome<Person>>;
	createPasswordReset(
		request: TargetedRequest,
	): Promise<PeopleOutcome<PasswordReset>>;
	recordRefusal(
		request: PeopleRequest & { targetId: string; outcome: GuardRefusal },
	): void;
}

export interface PeopleAdmin extends PeopleDirectory {
	enableByEmail(email: string): Promise<PeopleOutcome<Person>>;
	resetByEmail(email: string): Promise<PeopleOutcome<PasswordReset>>;
	applySignInSwitch(signInEnabled: boolean): void;
	close(): void;
}

export interface PeopleConfig {
	auth: Auth;
	store: IdentityStore;
	baseURL: string;
}

const STEP_UP_TTL_MS = 5 * 60 * 1000;
const STEP_UP_WINDOW_MS = 15 * 60 * 1000;
const STEP_UP_MAX_FAILURES = 5;
const RESET_TTL_MS = 24 * 60 * 60 * 1000;
const CREDENTIAL_PROVIDER = "credential";
const SHELL_ACTOR = "shell";

const refused = (refusal: PeopleRefusal): Refused => ({ ok: false, refusal });

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

const newSecret = (): string => randomBytes(32).toString("base64url");

const digestOf = (value: string): string =>
	createHash("sha256").update(value).digest("base64url");

/**
 * The identifier better-auth looks a reset row up by under
 * `verification.storeIdentifier: { overrides: { "reset-password": "hashed" } }`:
 * the SHA-256 of `reset-password:<token>`, base64url without padding.
 */
export const resetIdentifierOf = (token: string): string =>
	digestOf(`reset-password:${token}`);

const activeSessionCounts = (store: IdentityStore): Map<string, number> =>
	new Map(
		store.db
			.select({ userId: auth_session.userId, sessions: count() })
			.from(auth_session)
			.where(gt(auth_session.expiresAt, new Date()))
			.groupBy(auth_session.userId)
			.all()
			.map((row) => [row.userId, row.sessions]),
	);

const toPerson = (
	user: UserRow,
	callerId: string,
	sessions: Map<string, number>,
): Person => ({
	userId: user.userId,
	email: user.email,
	createdAt: user.createdAt.getTime(),
	lastSignInAt: user.lastSignInAt.getTime(),
	sessionCount: sessions.get(user.userId) ?? 0,
	status: user.disabled ? "Disabled" : "Active",
	isCaller: user.userId === callerId,
});

const personOf = (
	store: IdentityStore,
	userId: string,
	callerId: string,
): Person => {
	const user = findUser(store, userId);
	if (!user)
		throw new Error(`user ${userId} vanished inside its own transaction`);
	return toPerson(user, callerId, activeSessionCounts(store));
};

const userByEmail = (
	store: IdentityStore,
	email: string,
): UserRow | undefined => {
	const row = store.db
		.select({ userId: auth_user.id })
		.from(auth_user)
		.where(eq(sql`lower(${auth_user.email})`, email.trim().toLowerCase()))
		.get();
	return row && findUser(store, row.userId);
};

/**
 * Whether the caller may act at all, read inside the write transaction so two
 * users disabling each other are serialized and the second finds itself
 * disabled. A refusal is audited in the same transaction, which then commits.
 */
const callerRefusal = (
	store: IdentityStore,
	request: PeopleRequest,
	target: string,
): Refused | undefined => {
	const caller = findUser(store, request.callerId);
	if (caller && !caller.disabled) return undefined;
	store.audit({
		actor: request.callerId,
		target,
		action: "PeopleRequestRefused",
		outcome: "RefusedCallerDisabled",
		clientIp: request.clientIp,
	});
	return refused(PeopleErrorCode.CallerDisabled);
};

const stepUpRefusal = (
	store: IdentityStore,
	request: TargetedRequest,
	action: StepUpAction,
): Refused | undefined => {
	const spent = store.db
		.delete(identity_step_up)
		.where(
			and(
				eq(identity_step_up.digest, digestOf(request.stepUpToken)),
				eq(identity_step_up.callerUserId, request.callerId),
				eq(identity_step_up.action, action),
				eq(identity_step_up.targetUserId, request.targetId),
				gt(identity_step_up.expiresAt, new Date()),
			),
		)
		.returning({ digest: identity_step_up.digest })
		.all();
	if (spent.length === 1) return undefined;
	store.audit({
		actor: request.callerId,
		target: request.targetId,
		action: "PeopleRequestRefused",
		outcome: "RefusedStepUp",
		clientIp: request.clientIp,
	});
	return refused(PeopleErrorCode.StepUpRequired);
};

const issueReset = (
	store: IdentityStore,
	userId: string,
	scrambledHash: string,
): { token: string; expiresAt: Date } => {
	const { db } = store;
	const now = new Date();
	const token = newSecret();
	const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
	db.delete(auth_verification).where(eq(auth_verification.value, userId)).run();
	db.insert(auth_verification)
		.values({
			id: randomUUID(),
			identifier: resetIdentifierOf(token),
			value: userId,
			expiresAt,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.update(auth_account)
		.set({ password: scrambledHash, updatedAt: now })
		.where(
			and(
				eq(auth_account.userId, userId),
				eq(auth_account.providerId, CREDENTIAL_PROVIDER),
			),
		)
		.run();
	revokeUser(store, userId);
	return { token, expiresAt };
};

const disable = (store: IdentityStore, userId: string): void => {
	store.db
		.update(auth_user)
		.set({ disabled: true })
		.where(eq(auth_user.id, userId))
		.run();
	revokeUser(store, userId);
	store.db
		.delete(calendarFeedTokens)
		.where(
			eq(calendarFeedTokens.accountConfigId, deriveAccountConfigId(userId)),
		)
		.run();
};

const enable = (store: IdentityStore, userId: string): void => {
	store.db
		.update(auth_user)
		.set({ disabled: false })
		.where(eq(auth_user.id, userId))
		.run();
};

export const createPeopleDirectory = async (
	config: PeopleConfig,
): Promise<PeopleAdmin> => {
	const { store } = config;
	const { password: passwords } = await config.auth.$context;
	const resetUrlOf = (token: string): string =>
		`${config.baseURL}/reset-password/${token}`;
	const scrambledHash = (): Promise<string> => passwords.hash(newSecret());

	const credentialHash = (userId: string): string | null | undefined =>
		store.db
			.select({ hash: auth_account.password })
			.from(auth_account)
			.where(
				and(
					eq(auth_account.userId, userId),
					eq(auth_account.providerId, CREDENTIAL_PROVIDER),
				),
			)
			.get()?.hash;

	const passwordMatches = async (
		userId: string,
		password: string,
	): Promise<boolean> => {
		const hash = credentialHash(userId);
		if (!hash) return false;
		return passwords.verify({ hash, password });
	};

	const reserveAttempt = (request: StepUpRequest): PeopleOutcome<string> =>
		store.immediate(() => {
			const callerRefused = callerRefusal(store, request, request.targetId);
			if (callerRefused) return callerRefused;
			if (!findUser(store, request.targetId)) return refused("not_found");
			const failures =
				store.db
					.select({ failures: count() })
					.from(identity_audit_event)
					.where(
						and(
							eq(identity_audit_event.actor, request.callerId),
							eq(identity_audit_event.action, "StepUpFailed"),
							gt(
								identity_audit_event.occurredAt,
								new Date(Date.now() - STEP_UP_WINDOW_MS),
							),
						),
					)
					.get()?.failures ?? 0;
			if (failures >= STEP_UP_MAX_FAILURES)
				return refused(PeopleErrorCode.StepUpLocked);
			return ok(
				store.audit({
					actor: request.callerId,
					target: request.targetId,
					action: "StepUpFailed",
					outcome: "RefusedStepUp",
					clientIp: request.clientIp,
				}),
			);
		});

	const grantStepUp = (
		request: StepUpRequest,
		auditEventId: string,
	): PeopleOutcome<StepUpGrant> =>
		store.immediate(() => {
			const callerRefused = callerRefusal(store, request, request.targetId);
			if (callerRefused) return callerRefused;
			const now = new Date();
			const stepUpToken = newSecret();
			const expiresAt = new Date(now.getTime() + STEP_UP_TTL_MS);
			store.relabel(auditEventId, {
				actor: request.callerId,
				target: request.targetId,
				action: "StepUpPassed",
				outcome: "Succeeded",
				clientIp: request.clientIp,
			});
			store.db
				.delete(identity_step_up)
				.where(lte(identity_step_up.expiresAt, now))
				.run();
			store.db
				.insert(identity_step_up)
				.values({
					digest: digestOf(stepUpToken),
					callerUserId: request.callerId,
					action: request.action,
					targetUserId: request.targetId,
					expiresAt,
				})
				.run();
			return ok({ stepUpToken, expiresAt: expiresAt.getTime() });
		});

	const directory: PeopleAdmin = {
		listPeople: async (request) =>
			store.immediate(() => {
				const callerRefused = callerRefusal(store, request, "all");
				if (callerRefused) return callerRefused;
				const sessions = activeSessionCounts(store);
				const users = store.db
					.select({
						userId: auth_user.id,
						email: auth_user.email,
						disabled: auth_user.disabled,
						createdAt: auth_user.createdAt,
						lastSignInAt: auth_user.lastSignInAt,
					})
					.from(auth_user)
					.orderBy(asc(auth_user.email))
					.all();
				return ok(
					users.map((user) => toPerson(user, request.callerId, sessions)),
				);
			}),

		createStepUp: async (request) => {
			const attempt = reserveAttempt(request);
			if (!attempt.ok) return attempt;
			if (!(await passwordMatches(request.callerId, request.password))) {
				return refused(PeopleErrorCode.WrongPassword);
			}
			return grantStepUp(request, attempt.value);
		},

		signOutPerson: async (request) =>
			store.immediate(() => {
				const refusal =
					callerRefusal(store, request, request.targetId) ??
					stepUpRefusal(store, request, "SignOut");
				if (refusal) return refusal;
				if (!findUser(store, request.targetId)) return refused("not_found");
				revokeUser(store, request.targetId);
				store.audit({
					actor: request.callerId,
					target: request.targetId,
					action: "SessionsRevoked",
					outcome: "Succeeded",
					clientIp: request.clientIp,
				});
				return ok(personOf(store, request.targetId, request.callerId));
			}),

		updatePerson: async (request) =>
			store.immediate(() => {
				const disabling = request.status === "Disabled";
				const callerRefused = callerRefusal(store, request, request.targetId);
				if (callerRefused) return callerRefused;
				if (disabling && request.targetId === request.callerId) {
					store.audit({
						actor: request.callerId,
						target: request.targetId,
						action: "UserDisabled",
						outcome: "RefusedSelf",
						clientIp: request.clientIp,
					});
					return refused(PeopleErrorCode.CannotDisableSelf);
				}
				const stepUpRefused = stepUpRefusal(
					store,
					request,
					disabling ? "Disable" : "Enable",
				);
				if (stepUpRefused) return stepUpRefused;
				if (!findUser(store, request.targetId)) return refused("not_found");
				if (disabling) disable(store, request.targetId);
				else enable(store, request.targetId);
				store.audit({
					actor: request.callerId,
					target: request.targetId,
					action: disabling ? "UserDisabled" : "UserEnabled",
					outcome: "Succeeded",
					clientIp: request.clientIp,
				});
				return ok(personOf(store, request.targetId, request.callerId));
			}),

		createPasswordReset: async (request) => {
			const scrambled = await scrambledHash();
			const issued = store.immediate(
				(): PeopleOutcome<{ token: string; expiresAt: Date }> => {
					const refusal =
						callerRefusal(store, request, request.targetId) ??
						stepUpRefusal(store, request, "ResetPassword");
					if (refusal) return refusal;
					if (!findUser(store, request.targetId)) return refused("not_found");
					const reset = issueReset(store, request.targetId, scrambled);
					store.audit({
						actor: request.callerId,
						target: request.targetId,
						action: "PasswordResetIssued",
						outcome: "Succeeded",
						clientIp: request.clientIp,
					});
					return ok(reset);
				},
			);
			if (!issued.ok) return issued;
			return ok({
				person: personOf(store, request.targetId, request.callerId),
				resetUrl: resetUrlOf(issued.value.token),
				expiresAt: issued.value.expiresAt.getTime(),
			});
		},

		recordRefusal: (request) => {
			store.immediate(() =>
				store.audit({
					actor: request.callerId,
					target: request.targetId,
					action: "PeopleRequestRefused",
					outcome: request.outcome,
					clientIp: request.clientIp,
				}),
			);
		},

		enableByEmail: async (email) =>
			store.immediate(() => {
				const user = userByEmail(store, email);
				if (!user) return refused("not_found");
				enable(store, user.userId);
				store.audit({
					actor: SHELL_ACTOR,
					target: user.userId,
					action: "UserEnabled",
					outcome: "Succeeded",
					clientIp: HOST_CLIENT_IP,
				});
				return ok(personOf(store, user.userId, SHELL_ACTOR));
			}),

		resetByEmail: async (email) => {
			const scrambled = await scrambledHash();
			return store.immediate(() => {
				const user = userByEmail(store, email);
				if (!user) return refused("not_found");
				const reset = issueReset(store, user.userId, scrambled);
				store.audit({
					actor: SHELL_ACTOR,
					target: user.userId,
					action: "PasswordResetIssued",
					outcome: "Succeeded",
					clientIp: HOST_CLIENT_IP,
				});
				return ok({
					person: personOf(store, user.userId, SHELL_ACTOR),
					resetUrl: resetUrlOf(reset.token),
					expiresAt: reset.expiresAt.getTime(),
				});
			});
		},

		applySignInSwitch: (signInEnabled) =>
			applySignInSwitch(store, signInEnabled),

		close: () => store.close(),
	};
	return directory;
};
