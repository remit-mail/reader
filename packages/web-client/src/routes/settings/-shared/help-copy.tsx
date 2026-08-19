import { Kbd } from "@remit/ui";

export const sendersHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">VIP</strong> senders get priority surface in
			the daily brief and notification escalation, even when an account is
			quiet.
		</p>
		<p>
			<strong className="text-fg">Muted</strong> senders never notify and stay
			out of the brief. Their mail still syncs and stays searchable.
		</p>
		<p>
			<strong className="text-fg">Blocked</strong> senders never load images and
			go straight to junk.
		</p>
		<p>
			Tip: flag from the keyboard on any message — <Kbd>v</Kbd> VIP,{" "}
			<Kbd>m</Kbd> mute, <Kbd>b</Kbd> block. Every rule an automation creates
			shows up here and can be removed.
		</p>
	</div>
);

export const accountsHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Sync health</strong> shows the IMAP connection
			state and the last successful sync per account.
		</p>
		<p>
			<strong className="text-fg">Error</strong> means the last connection
			attempt failed — the raw server response is shown on the card. Reconnect
			re-runs the connection test from the add-account wizard.
		</p>
		<p>
			<strong className="text-fg">Muted</strong> accounts keep syncing but stay
			out of the daily brief and unified counts.
		</p>
	</div>
);

export const appearanceHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Density</strong> controls how much information
			fits on screen. Compact is great on smaller displays; Comfortable gives
			each item more breathing room.
		</p>
		<p>
			<strong className="text-fg">Theme</strong> switches between light, dark,
			and system-preference modes instantly. The change takes effect across the
			whole app immediately.
		</p>
		<p className="text-2xs text-fg-subtle">
			Preferences are stored locally in this browser. Server-side sync is coming
			soon.
		</p>
	</div>
);

export const advancedHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Notification rules</strong> and data export
			are coming in a future release.
		</p>
		<p>
			A message Remit cannot read is{" "}
			<strong className="text-fg">set aside</strong> rather than skipped, and
			the folder keeps syncing. Setting one aside is a defect in Remit, so every
			entry can be reported with the diagnostics already attached.
		</p>
	</div>
);
