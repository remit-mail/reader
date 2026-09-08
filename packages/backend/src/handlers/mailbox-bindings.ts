import type {
	FilterItem,
	IAccountSettingRepository,
	IFilterRepository,
	MailboxItem,
} from "@remit/data-ports";
import { FILTER_NO_ACTION } from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";
import type { CanonicalMailboxRoleValue } from "@remit/data-ports/folder-role";
import { loadFolderAppointmentsForAccount } from "./folder-role-appointments.js";

/**
 * What a folder is bound to: the filters that move mail into it, and the
 * canonical roles it has been appointed to.
 */
export interface MailboxBindings {
	filterNames: string[];
	roles: CanonicalMailboxRoleValue[];
}

/**
 * `filter.actionMailboxId` has no reverse index, so the filters are listed for
 * the account config and matched — they are few and per-config, so this is not
 * a mailbox scan. Role appointments are `account_setting` rows whose *value* is
 * a mailboxId, which a `mailbox_id` column scan cannot find, so the existing
 * per-account appointment map answers for them.
 */
export const loadMailboxBindings = async (
	client: {
		filter: Pick<IFilterRepository, "listByAccountConfig">;
		accountSetting: Pick<IAccountSettingRepository, "get">;
	},
	accountConfigId: string,
	accountId: string,
	mailboxId: string,
): Promise<MailboxBindings> => {
	const [filters, appointments] = await Promise.all([
		client.filter.listByAccountConfig(accountConfigId),
		loadFolderAppointmentsForAccount(
			client.accountSetting,
			accountConfigId,
			accountId,
		),
	]);

	const filterNames = filters
		.filter(
			(filter: FilterItem) =>
				filter.actionMailboxId !== FILTER_NO_ACTION &&
				filter.actionMailboxId === mailboxId,
		)
		.map((filter: FilterItem) => filter.name);

	const roles: CanonicalMailboxRoleValue[] = [];
	for (const [role, appointment] of appointments) {
		if (appointment.mailboxId === mailboxId) {
			roles.push(role as CanonicalMailboxRoleValue);
		}
	}

	return { filterNames, roles };
};

const asList = (items: readonly string[]): string =>
	items.length === 1
		? items[0]
		: `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * Refuse a delete while any durable reference is bound to the folder (D16).
 *
 * This is what makes the settled-target rule total: a binding is only created
 * against a settled folder and only removed by the user, so a `mailboxId` that
 * names nothing never exists and no reader of a filter's `actionMailboxId` or a
 * role appointment needs a missing-target branch. It removes code rather than
 * adding a check.
 *
 * The alternatives both cost more than they look. `Filter` has no enabled flag
 * and its `actionMailboxId` sentinel means "no move action", so clearing the
 * target silently turns a move-filter into one that does something else;
 * deleting the user's filters outright is not a decision a folder delete gets
 * to make.
 *
 * The message **names** each binding rather than counting them, because a count
 * is not actionable — and this fires on ordinary configurations, since pointing
 * a filter at a folder is what filters are for.
 */
export const assertNoBindings = (
	mailbox: Pick<MailboxItem, "fullPath">,
	bindings: MailboxBindings,
): void => {
	const clauses: string[] = [];
	if (bindings.filterNames.length > 0) {
		clauses.push(
			`the ${bindings.filterNames.length === 1 ? "filter" : "filters"} ${asList(
				bindings.filterNames.map((name) => `“${name}”`),
			)}`,
		);
	}
	if (bindings.roles.length > 0) {
		clauses.push(
			`the ${asList(bindings.roles)} ${
				bindings.roles.length === 1 ? "role" : "roles"
			}`,
		);
	}
	if (clauses.length === 0) return;
	throw new BadRequestError(
		`“${mailbox.fullPath}” is used by ${asList(clauses)}.`,
	);
};
