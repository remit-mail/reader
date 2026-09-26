/**
 * Turning mail or calendar off for one account, and every surface that then has
 * to say so (#1179, ADR `provider-service-selection.md`).
 *
 * Disabling deletes nothing. A mail-disabled account still holds every message
 * it synced and a paused calendar still holds every event it read, so the
 * screens here are the ones that have to make that believable: the account keeps
 * its place in the list, the picker and the nav, its stored rows open and read
 * normally, and each surface says which service stopped rather than reading as
 * an empty mailbox or a broken account.
 *
 * No mutation is wired. The settings screen holds its own answers so the flow
 * can be clicked: a switch asks, the confirmation states what stays and what
 * stops, and only then does the screen move.
 */
import {
	ACCOUNT_NO_SERVICE_TOGGLES_MESSAGE,
	AccountHealthCard,
	type AccountService,
	type AccountServiceChange,
	AccountServiceChangeDialog,
	type AccountServiceIntent,
	AccountServiceOffBadge,
	AccountServiceOffNotice,
	AccountServiceToggles,
	Banner,
	Button,
	type CalendarColorId,
	CalendarGrid,
	CalendarList,
	type SettingsNavItem,
	SettingsShell,
} from "@remit/ui";
import { Check, Inbox, Palette, Users, Wrench } from "lucide-react";
import { useState } from "react";
import {
	calendars,
	HOME_ZONE,
	NOW_ISO,
	TODAY,
	events as weekEvents,
	workCalendarId,
} from "../fixtures/calendar.js";

const navItems: SettingsNavItem[] = [
	{ id: "accounts", label: "Accounts", icon: <Inbox className="size-4" /> },
	{
		id: "senders",
		label: "Senders & Rules",
		icon: <Users className="size-4" />,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: <Palette className="size-4" />,
	},
	{ id: "advanced", label: "Advanced", icon: <Wrench className="size-4" /> },
];

const BOTH_SERVICES: AccountService[] = ["Mail", "Calendar"];

/** What the round trip or the removal route left on screen, once it returned. */
type Outcome =
	| { kind: "none" }
	| { kind: "granted"; service: AccountService }
	| { kind: "remove" };

export interface AccountServiceSettingsProps {
	/** An IMAP account carries mail alone and is offered no switches. */
	connector?: "microsoft" | "imap";
	label?: string;
	email?: string;
	/** Services the account syncs on mount. */
	services?: AccountService[];
	/** Services the account's grant already covers. */
	consented?: AccountService[];
	/** Opens straight on a pending question, for a story about the dialog. */
	pending?: AccountServiceChange;
}

/**
 * Account settings for one account: what it syncs, and the question each switch
 * raises before anything changes.
 */
export function AccountServiceSettings({
	connector = "microsoft",
	label = "Work",
	email = "alice@northwind.example",
	services = BOTH_SERVICES,
	consented = BOTH_SERVICES,
	pending,
}: AccountServiceSettingsProps) {
	const providerName = connector === "microsoft" ? "Microsoft" : "IMAP";
	const offered: AccountService[] =
		connector === "microsoft" ? BOTH_SERVICES : ["Mail"];

	const [enabled, setEnabled] = useState(services);
	const [change, setChange] = useState<AccountServiceChange | null>(
		pending ?? null,
	);
	const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });

	const requestChange = (
		service: AccountService,
		intent: AccountServiceIntent,
	) => {
		setOutcome({ kind: "none" });
		if (intent === "off") {
			setChange({
				kind: enabled.length === 1 ? "last" : "disable",
				service,
			});
			return;
		}
		if (!consented.includes(service)) {
			setChange({ kind: "enable", service });
			return;
		}
		setEnabled((prev) =>
			BOTH_SERVICES.filter((s) => s === service || prev.includes(s)),
		);
	};

	const confirm = () => {
		if (change === null) return;
		if (change.kind === "disable") {
			setEnabled((prev) =>
				prev.filter((service) => service !== change.service),
			);
		}
		if (change.kind === "enable") {
			// The prototype stands in for the provider: the round trip comes back
			// granted, which is the only branch this screen has a state for.
			setEnabled((prev) =>
				BOTH_SERVICES.filter((s) => s === change.service || prev.includes(s)),
			);
			setOutcome({ kind: "granted", service: change.service });
		}
		if (change.kind === "last") setOutcome({ kind: "remove" });
		setChange(null);
	};

	const mailOff = !enabled.includes("Mail");

	return (
		<SettingsShell
			items={navItems}
			activeId="accounts"
			title="Accounts"
			description="Every account keeps what it synced — a service you switch off just stops adding to it."
			onBackToMail={() => undefined}
		>
			<AccountHealthCard
				label={label}
				email={email}
				connector={providerName}
				syncLabel={mailOff ? "mail paused, synced 3h ago" : "synced 2m ago"}
				state="healthy"
				trailing={
					mailOff ? <AccountServiceOffBadge service="Mail" /> : undefined
				}
			/>

			<section className="rounded-sm border border-line bg-surface px-row-inset py-3">
				<AccountServiceToggles
					providerName={providerName}
					offered={offered}
					enabled={enabled}
					consented={consented}
					onRequestChange={requestChange}
				/>
				{offered.length < 2 && (
					<p className="text-sm text-fg-muted">
						{ACCOUNT_NO_SERVICE_TOGGLES_MESSAGE}
					</p>
				)}
			</section>

			{outcome.kind === "granted" && (
				<Banner tone="success" variant="soft">
					{`${providerName} granted ${outcome.service.toLowerCase()} access. Syncing starts with the next round.`}
				</Banner>
			)}
			{outcome.kind === "remove" && (
				<Banner tone="warning" variant="soft">
					Removing an account is the way to sync nothing. It deletes what Remit
					stored for it — switching a service off never does.
				</Banner>
			)}

			<AccountServiceChangeDialog
				change={change}
				providerName={providerName}
				onConfirm={confirm}
				onCancel={() => setChange(null)}
			/>
		</SettingsShell>
	);
}

interface ListedAccount {
	id: string;
	label: string;
	email: string;
	connector: string;
	syncLabel: string;
	off?: AccountService;
}

const listedAccounts: ListedAccount[] = [
	{
		id: "acc_personal",
		label: "Personal",
		email: "alice.tan@gmail.example",
		connector: "IMAP",
		syncLabel: "synced 2m ago",
	},
	{
		id: "acc_work",
		label: "Work",
		email: "alice@northwind.example",
		connector: "Microsoft",
		syncLabel: "mail paused, synced 3h ago",
		off: "Mail",
	},
	{
		id: "acc_hobby",
		label: "Synthwave Forum",
		email: "alice@synthcollective.example",
		connector: "Microsoft",
		syncLabel: "synced 12m ago",
		off: "Calendar",
	},
];

/**
 * The account list with a mail-disabled account in it. It is listed, labelled
 * and manageable, and it sits where it always sat — a missing account reads as
 * a deleted one.
 */
export function AccountListWithServiceOff() {
	return (
		<SettingsShell
			items={navItems}
			activeId="accounts"
			title="Accounts"
			description="Every account keeps what it synced — a service you switch off just stops adding to it."
			onBackToMail={() => undefined}
		>
			<div className="space-y-3">
				{listedAccounts.map((account) => (
					<AccountHealthCard
						key={account.id}
						label={account.label}
						email={account.email}
						connector={account.connector}
						syncLabel={account.syncLabel}
						state="healthy"
						trailing={
							<div className="flex items-center gap-2">
								{account.off && (
									<AccountServiceOffBadge service={account.off} />
								)}
								<Button variant="ghost" size="sm">
									Manage
								</Button>
							</div>
						}
					/>
				))}
			</div>
		</SettingsShell>
	);
}

/**
 * The account picker — the menu that scopes a view to one account. A service
 * being off changes what the account is adding to, never whether it can be
 * picked, so every account is here and the one that stopped says which service.
 */
export function AccountPickerWithServiceOff({
	pickedId = "acc_work",
}: {
	pickedId?: string;
}) {
	const [picked, setPicked] = useState(pickedId);
	return (
		<div className="mx-auto mt-8 w-72 rounded-md border border-line bg-surface p-1 shadow-lg">
			<p className="px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				Show mail from
			</p>
			{listedAccounts.map((account) => (
				<button
					key={account.id}
					type="button"
					onClick={() => setPicked(account.id)}
					aria-pressed={picked === account.id}
					className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-surface-sunken"
				>
					<Check
						className={`size-4 shrink-0 text-accent-2 ${
							picked === account.id ? "" : "invisible"
						}`}
						aria-hidden
					/>
					<span className="min-w-0 flex-1 truncate">{account.label}</span>
					{account.off && <AccountServiceOffBadge service={account.off} />}
				</button>
			))}
		</div>
	);
}

const colorByCalendarId: Record<string, CalendarColorId> = Object.fromEntries(
	calendars.map((calendar) => [calendar.id, calendar.color]),
);

/**
 * The calendar with a paused provider calendar on it. Sync stopped at the last
 * completed round; the events it read are still drawn, still coloured, and
 * still tickable. Only the label and the notice are new.
 */
export function PausedProviderCalendar() {
	const paused = calendars.map((calendar) =>
		calendar.id === workCalendarId
			? { ...calendar, sync: "paused" as const }
			: calendar,
	);
	const [visible, setVisible] = useState<ReadonlySet<string>>(
		() => new Set(calendars.map((calendar) => calendar.id)),
	);
	const toggle = (calendarId: string) =>
		setVisible((prev) => {
			const next = new Set(prev);
			if (!next.delete(calendarId)) next.add(calendarId);
			return next;
		});

	return (
		<div className="flex h-dvh w-full bg-canvas font-sans text-fg">
			<aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface-sunken py-3 lg:flex">
				<div className="px-row-inset">
					<AccountServiceOffNotice
						service="Calendar"
						onEnable={() => undefined}
					/>
				</div>
				<CalendarList
					calendars={paused}
					visible={visible}
					onToggle={toggle}
					onToggleAccount={() => undefined}
				/>
			</aside>
			<div className="min-w-0 flex-1 bg-surface">
				<CalendarGrid
					view="week"
					date={TODAY}
					events={weekEvents.filter((event) => visible.has(event.calendarId))}
					colorByCalendarId={colorByCalendarId}
					density="comfortable"
					selectedEventId=""
					timeZone={HOME_ZONE}
					now={NOW_ISO}
					onSelectEvent={() => undefined}
					onPickSlot={() => undefined}
					onRangeChange={() => undefined}
				/>
			</div>
		</div>
	);
}
