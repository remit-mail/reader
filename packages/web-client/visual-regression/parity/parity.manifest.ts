/**
 * Parity manifest — every surface/state from the #816 inventory.
 *
 * One row per discrete state. Each row binds a live route (+ optional step
 * sequence to reach sub-states) to the matching Storybook story id, or null
 * when no design story exists yet.
 *
 * Story ids are taken verbatim from Storybook's /index.json
 * (`npm run storybook -w packages/remit-workbench`).
 */

export type Surface = "auth" | "onboarding" | "settings" | "mail";
export type Viewport = "phone" | "tablet" | "desktop";

export type Step =
	| { action: "click"; selector: string }
	| { action: "fill"; selector: string; value: string }
	| { action: "wait"; selector: string };

export type ParityRow = {
	surface: Surface;
	/** kebab, unique within surface */
	state: string;
	viewports: Viewport[];
	live: {
		route: string;
		steps?: Step[];
	};
	/** null = no design yet → P4 "needs a story" */
	story: { id: string } | null;
};

export const manifest: ParityRow[] = [
	// ─────────────────────────────────────────────────────────────────────────
	// AUTH
	// ─────────────────────────────────────────────────────────────────────────
	{
		surface: "auth",
		state: "sign-in",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/sign-in" },
		story: { id: "screens-signin--sign-in-mobile" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// ONBOARDING
	// ─────────────────────────────────────────────────────────────────────────
	{
		surface: "onboarding",
		state: "welcome",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--welcome" },
	},
	{
		surface: "onboarding",
		state: "connector-picker",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{
					action: "click",
					selector: "[data-step='connector'] button[data-next]",
				},
			],
		},
		story: { id: "flows-onboarding--connector-picker" },
	},
	{
		surface: "onboarding",
		state: "connector-picker-microsoft",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [{ action: "click", selector: "[data-connector='microsoft']" }],
		},
		story: { id: "flows-onboarding--connector-picker-microsoft" },
	},
	{
		surface: "onboarding",
		state: "microsoft-sign-in",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "[data-connector='microsoft']" },
				{ action: "click", selector: "button[data-next]" },
			],
		},
		story: { id: "flows-onboarding--microsoft-email" },
	},
	{
		surface: "onboarding",
		state: "address-autodiscovery",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "button[data-next]" },
				{
					action: "fill",
					selector: "input[type='email']",
					value: "user@example.com",
				},
			],
		},
		story: { id: "flows-onboarding--address-autodiscovery" },
	},
	{
		surface: "onboarding",
		state: "address-validation-error",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "button[data-next]" },
				{
					action: "fill",
					selector: "input[type='email']",
					value: "notanemail",
				},
				{ action: "click", selector: "button[data-next]" },
			],
		},
		story: { id: "flows-onboarding--address-invalid" },
	},
	{
		surface: "onboarding",
		state: "servers-detected",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "button[data-next]" },
				{
					action: "fill",
					selector: "input[type='email']",
					value: "user@gmail.com",
				},
				{ action: "click", selector: "button[data-next]" },
			],
		},
		story: { id: "flows-onboarding--server-confirm" },
	},
	{
		surface: "onboarding",
		state: "servers-detected-phone",
		viewports: ["phone"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "button[data-next]" },
				{
					action: "fill",
					selector: "input[type='email']",
					value: "user@gmail.com",
				},
				{ action: "click", selector: "button[data-next]" },
			],
		},
		story: { id: "flows-onboarding--server-confirm-phone" },
	},
	{
		surface: "onboarding",
		state: "servers-provider-preset",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "button[data-next]" },
				{
					action: "fill",
					selector: "input[type='email']",
					value: "user@icloud.com",
				},
				{ action: "click", selector: "button[data-next]" },
			],
		},
		story: { id: "flows-onboarding--server-provider-preset" },
	},
	{
		surface: "onboarding",
		state: "servers-manual-fallback",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "button[data-next]" },
				{
					action: "fill",
					selector: "input[type='email']",
					value: "user@custom.example",
				},
				{ action: "click", selector: "button[data-next]" },
			],
		},
		story: { id: "flows-onboarding--server-manual-fallback" },
	},
	{
		surface: "onboarding",
		state: "servers-validation-error",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/onboarding",
			steps: [
				{ action: "click", selector: "button[data-next]" },
				{
					action: "fill",
					selector: "input[type='email']",
					value: "user@custom.example",
				},
				{ action: "click", selector: "button[data-next]" },
				{ action: "click", selector: "button[data-next]" },
			],
		},
		story: { id: "flows-onboarding--server-missing-host" },
	},
	{
		surface: "onboarding",
		state: "credentials",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--credentials" },
	},
	{
		surface: "onboarding",
		state: "test-connection-success",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--test-connection-success" },
	},
	{
		surface: "onboarding",
		state: "test-connection-auth-failure",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--test-connection-failure" },
	},
	{
		surface: "onboarding",
		state: "test-connection-network-failure",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--test-connection-network-failure" },
	},
	{
		surface: "onboarding",
		state: "sync-progress",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--sync-progress" },
	},
	{
		surface: "onboarding",
		state: "sync-create-error",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--sync-create-error" },
	},
	{
		surface: "onboarding",
		state: "sync-stalled",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/onboarding" },
		story: { id: "flows-onboarding--sync-stalled" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// SETTINGS
	// ─────────────────────────────────────────────────────────────────────────
	{
		surface: "settings",
		state: "shell-desktop",
		viewports: ["desktop"],
		live: { route: "/settings/accounts" },
		story: { id: "screens-settings--accounts" },
	},
	{
		surface: "settings",
		state: "shell-tablet",
		viewports: ["tablet"],
		live: { route: "/settings/accounts" },
		story: null,
	},
	{
		surface: "settings",
		state: "shell-phone",
		viewports: ["phone"],
		live: { route: "/settings/accounts" },
		story: null,
	},
	{
		surface: "settings",
		state: "accounts-populated",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/settings/accounts" },
		story: { id: "screens-settings--accounts" },
	},
	{
		surface: "settings",
		state: "accounts-empty",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/settings/accounts" },
		story: { id: "screens-settings--accounts-empty" },
	},
	{
		surface: "settings",
		state: "accounts-loading",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/settings/accounts" },
		story: { id: "screens-settings--accounts-loading" },
	},
	{
		surface: "settings",
		state: "accounts-oauth-success",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/settings/accounts",
			steps: [{ action: "wait", selector: "[data-oauth-success]" }],
		},
		story: { id: "screens-settings--accounts-oauth-success" },
	},
	{
		surface: "settings",
		state: "accounts-oauth-error",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/settings/accounts",
			steps: [{ action: "wait", selector: "[data-oauth-error]" }],
		},
		story: { id: "screens-settings--accounts-oauth-error" },
	},
	{
		surface: "settings",
		state: "accounts-delete-confirm",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/settings/accounts",
			steps: [{ action: "click", selector: "[data-delete-account]" }],
		},
		story: { id: "screens-settings--accounts-delete-confirm" },
	},
	{
		surface: "settings",
		state: "accounts-danger-zone",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/settings/accounts" },
		story: { id: "screens-settings--danger-zone" },
	},
	{
		surface: "settings",
		state: "senders-and-rules",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/settings/senders" },
		story: { id: "screens-settings--senders-and-rules" },
	},
	{
		surface: "settings",
		state: "appearance",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/settings/appearance" },
		story: { id: "screens-settings--appearance" },
	},
	{
		surface: "settings",
		state: "advanced",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/settings/advanced" },
		story: { id: "screens-settings--advanced" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// MAIL
	// ─────────────────────────────────────────────────────────────────────────
	{
		surface: "mail",
		state: "brief-default",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail" },
		story: { id: "flows-dailybrief--default" },
	},
	{
		surface: "mail",
		state: "brief-filtered",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/mail",
			steps: [{ action: "click", selector: "[data-filter-chip]" }],
		},
		story: { id: "flows-dailybrief--filtered" },
	},
	{
		surface: "mail",
		state: "brief-caught-up",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail" },
		story: { id: "flows-dailybrief--caught-up" },
	},
	{
		surface: "mail",
		state: "brief-keyboard-hints",
		viewports: ["desktop"],
		live: { route: "/mail" },
		story: null,
	},
	{
		surface: "mail",
		state: "list-comfortable",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail/$mailboxId" },
		story: { id: "screens-appshell--default" },
	},
	{
		surface: "mail",
		state: "list-compact",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail/$mailboxId" },
		story: { id: "screens-appshell--compact-density" },
	},
	{
		surface: "mail",
		state: "reading-pane-empty",
		viewports: ["desktop"],
		live: { route: "/mail" },
		story: { id: "screens-appshell--no-thread-toolbar" },
	},
	{
		surface: "mail",
		state: "reading-pane-thread",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [{ action: "click", selector: "[data-thread-row]" }],
		},
		story: { id: "screens-appshell--default" },
	},
	{
		surface: "mail",
		state: "intelligence-pane-default",
		viewports: ["desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [{ action: "click", selector: "[data-thread-row]" }],
		},
		story: { id: "screens-appshell--default" },
	},
	{
		surface: "mail",
		state: "intelligence-pane-collapsed",
		viewports: ["desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{ action: "click", selector: "[data-thread-row]" },
				{ action: "click", selector: "[data-toggle-intelligence]" },
			],
		},
		story: { id: "screens-appshell--intelligence-collapsed" },
	},
	{
		surface: "mail",
		state: "intelligence-phishing",
		viewports: ["desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{ action: "click", selector: "[data-thread-row][data-phishing]" },
			],
		},
		story: { id: "screens-appshell--phishing-detected" },
	},
	{
		surface: "mail",
		state: "intelligence-phone-drawer",
		viewports: ["phone"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{ action: "click", selector: "[data-thread-row]" },
				{ action: "click", selector: "[data-open-intelligence]" },
			],
		},
		story: { id: "screens-mobileconversation--intelligence-open" },
	},
	{
		surface: "mail",
		state: "toolbar-no-thread",
		viewports: ["desktop"],
		live: { route: "/mail" },
		story: { id: "screens-appshell--no-thread-toolbar" },
	},
	{
		surface: "mail",
		state: "tablet-two-pane",
		viewports: ["tablet"],
		live: { route: "/mail" },
		story: { id: "screens-appshell--tablet-two-pane" },
	},
	{
		surface: "mail",
		state: "mobile-thread-chrome",
		viewports: ["phone"],
		live: {
			route: "/mail/$mailboxId",
			steps: [{ action: "click", selector: "[data-thread-row]" }],
		},
		story: { id: "screens-mobileconversation--default" },
	},
	{
		surface: "mail",
		state: "compose-full",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/mail",
			steps: [{ action: "click", selector: "[data-compose-fab]" }],
		},
		story: { id: "flows-compose--full" },
	},
	{
		surface: "mail",
		state: "compose-inline-reply",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{ action: "click", selector: "[data-thread-row]" },
				{ action: "click", selector: "[data-reply-button]" },
			],
		},
		story: { id: "flows-compose--inline" },
	},
	{
		surface: "mail",
		state: "compose-mobile-sheet",
		viewports: ["phone"],
		live: {
			route: "/mail",
			steps: [{ action: "click", selector: "[data-compose-fab]" }],
		},
		story: { id: "flows-compose--mobile-compose-sheet" },
	},
	{
		surface: "mail",
		state: "outbox-all-statuses",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail/outbox" },
		story: { id: "flows-outbox--all-statuses" },
	},
	{
		surface: "mail",
		state: "outbox-empty",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail/outbox" },
		story: { id: "flows-outbox--empty" },
	},
	{
		surface: "mail",
		state: "drafts",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail/$mailboxId" },
		story: { id: "flows-drafts--segmented" },
	},
	{
		surface: "mail",
		state: "drafts-empty",
		viewports: ["phone", "tablet", "desktop"],
		live: { route: "/mail/$mailboxId" },
		story: { id: "flows-drafts--empty" },
	},
	{
		surface: "mail",
		state: "search-overlay",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/mail",
			steps: [{ action: "click", selector: "[data-search-trigger]" }],
		},
		story: { id: "flows-search--results" },
	},
	{
		surface: "mail",
		state: "selection-desktop",
		viewports: ["desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{
					action: "click",
					selector: "[data-thread-row] [data-select-checkbox]",
				},
			],
		},
		story: { id: "flows-mailpickers--selection-desktop" },
	},
	{
		surface: "mail",
		state: "selection-mobile",
		viewports: ["phone"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{
					action: "click",
					selector: "[data-thread-row] [data-select-checkbox]",
				},
			],
		},
		story: { id: "flows-mailpickers--selection-mobile" },
	},
	{
		surface: "mail",
		state: "move-to-mailbox-picker",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{
					action: "click",
					selector: "[data-thread-row] [data-select-checkbox]",
				},
				{ action: "click", selector: "[data-move-button]" },
			],
		},
		story: { id: "flows-mailpickers--move-picker" },
	},
	{
		surface: "mail",
		state: "reclassify-sender-dialog",
		viewports: ["phone", "tablet", "desktop"],
		live: {
			route: "/mail/$mailboxId",
			steps: [
				{ action: "click", selector: "[data-thread-row]" },
				{ action: "click", selector: "[data-reclassify-button]" },
			],
		},
		story: { id: "flows-mailpickers--reclassify-dialog" },
	},
];
