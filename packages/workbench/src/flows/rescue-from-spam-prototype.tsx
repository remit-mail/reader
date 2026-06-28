import {
	Avatar,
	Banner,
	BottomSheet,
	Button,
	type MoveMailboxOption,
	MoveMailboxPicker,
	RescueBanner,
	type RescueCandidate,
	RescueCandidateRow,
} from "@remit/ui";
import { CheckCircle2, HelpCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";

type Step = "review" | "destination" | "done";

interface SpamNoise {
	sender: string;
	address: string;
	subject: string;
}

const CANDIDATES: RescueCandidate[] = [
	{
		id: "c1",
		senderName: "Anna de Vries",
		senderAddress: "anna@studio-noord.nl",
		subject: "Re: invoice for the September shoot",
		snippet:
			"Thanks for the quick turnaround — final files attached as agreed.",
		trustReason: "We can verify this sender",
		trustSubReason: "You've emailed them before",
		senderTrust: "wellknown",
	},
	{
		id: "c2",
		senderName: "Mum",
		senderAddress: "mum@gmail.com",
		subject: "dinner sunday?",
		snippet: "Let me know if you and the kids are coming over this weekend.",
		trustReason: "We can verify this sender",
		trustSubReason: "Someone you email often",
		senderTrust: "vip",
	},
	{
		id: "c3",
		senderName: "Stripe",
		senderAddress: "receipts@stripe.com",
		subject: "Your payout of €1,240.00 is on the way",
		snippet: "A summary of the payout settled to your bank account.",
		trustReason: "We can verify this sender",
		trustSubReason: "Passed authentication",
	},
	{
		id: "c4",
		senderName: "Tweakers Aanbiedingen",
		senderAddress: "nieuwsbrief@tweakers.net",
		subject: "Pricewatch: deals of the week",
		snippet: "The lowest prices we tracked across the shops you follow.",
		trustReason: "We can verify this sender",
		trustSubReason: "Known mailing list you read",
	},
	{
		id: "c5",
		senderName: "Huisarts Centrum Oost",
		senderAddress: "no-reply@hcoost.nl",
		subject: "Afspraakbevestiging — 3 juli 09:20",
		snippet: "This confirms your appointment. Reply STOP to cancel.",
		trustReason: "We can verify this sender",
		trustSubReason: "You've emailed them before",
		senderTrust: "wellknown",
	},
];

const SPAM_NOISE: SpamNoise[] = [
	{
		sender: "WINNER NOTIFICATION",
		address: "claims@lotto-intl.biz",
		subject: "YOU HAVE WON £950,000.00 GBP !!!",
	},
	{
		sender: "Account Security",
		address: "support@app1e-id-verify.com",
		subject: "Your account will be suspended in 24h — verify now",
	},
	{
		sender: "Pharmacy Deals",
		address: "deals@meds-cheap-rx.ru",
		subject: "Blue pills 80% off, no prescription needed",
	},
];

const FOLDERS: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox" },
	{ id: "spam", label: "Spam", isCurrent: true },
	{ id: "receipts", label: "Receipts" },
	{ id: "newsletters", label: "Newsletters" },
	{ id: "family", label: "Family" },
	{ id: "work", label: "Work", searchValue: "work clients projects" },
];

const folderLabel = (id: string): string =>
	FOLDERS.find((f) => f.id === id)?.label ?? "Inbox";

const plural = (n: number): string => (n === 1 ? "message" : "messages");

function ExplainWhy() {
	return (
		<Banner tone="info" variant="soft">
			<p className="text-2xs text-fg-muted">
				We list a message here only when we can confirm the sender is who they
				say — usually someone you've emailed before, write to often, or a
				service that consistently checks out. We never guess from words in the
				subject. Anything we can't confirm stays in Spam.
			</p>
		</Banner>
	);
}

function ReviewStep({
	candidates,
	selected,
	onToggle,
	onSelectAll,
	onSelectNone,
	onContinue,
	onCancel,
}: {
	candidates: RescueCandidate[];
	selected: Set<string>;
	onToggle: (id: string) => void;
	onSelectAll: () => void;
	onSelectNone: () => void;
	onContinue: () => void;
	onCancel: () => void;
}) {
	const [showWhy, setShowWhy] = useState(false);
	const count = selected.size;
	return (
		<div className="flex min-h-0 flex-col">
			<div className="px-row-inset pb-2 pt-1">
				<div className="flex items-start justify-between gap-2">
					<h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
						<ShieldCheck className="size-4 text-positive" aria-hidden />
						Rescue from Spam
					</h2>
					<Button
						variant="ghost"
						size="sm"
						icon={<HelpCircle className="size-3.5" />}
						onClick={() => setShowWhy((v) => !v)}
						className="-mr-1.5 -mt-0.5"
					>
						Why these?
					</Button>
				</div>
				<p className="mt-1 text-2xs text-fg-subtle">
					These look safe — from senders we can verify. Uncheck anything that
					belongs in Spam.
				</p>
				{showWhy && (
					<div className="mt-2">
						<ExplainWhy />
					</div>
				)}
			</div>

			<div className="flex items-center justify-between px-row-inset pb-1.5">
				<span className="text-2xs font-medium text-fg-muted">
					{count} of {candidates.length} selected
				</span>
				<span className="flex gap-1">
					<Button variant="ghost" size="sm" onClick={onSelectAll}>
						Select all
					</Button>
					<Button variant="ghost" size="sm" onClick={onSelectNone}>
						Select none
					</Button>
				</span>
			</div>

			<div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto border-y border-line">
				{candidates.map((candidate) => (
					<RescueCandidateRow
						key={candidate.id}
						candidate={candidate}
						selected={selected.has(candidate.id)}
						onToggle={() => onToggle(candidate.id)}
					/>
				))}
			</div>

			<div className="space-y-2 border-t border-line bg-surface px-row-inset py-3">
				<Button
					variant="primary"
					onClick={onContinue}
					className="h-11 w-full font-semibold"
				>
					Continue with {count} {plural(count)}
				</Button>
				<Button variant="ghost" onClick={onCancel} className="h-11 w-full">
					Cancel
				</Button>
			</div>
		</div>
	);
}

function DestinationStep({
	count,
	destination,
	onPick,
	onMove,
	onBack,
}: {
	count: number;
	destination: string;
	onPick: (id: string) => void;
	onMove: () => void;
	onBack: () => void;
}) {
	const [picking, setPicking] = useState(false);

	return (
		<div className="flex min-h-0 flex-col">
			<div className="px-row-inset pb-2 pt-1">
				<h2 className="text-sm font-semibold text-fg">Where should they go?</h2>
				<p className="mt-1 text-2xs text-fg-subtle">
					Pick a folder, then we move them out of Spam.
				</p>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-row-inset py-2">
				{picking ? (
					<div className="overflow-hidden rounded-xl border border-line bg-surface">
						<MoveMailboxPicker
							mailboxes={FOLDERS}
							autoFocus
							onSelect={(id) => {
								onPick(id);
								setPicking(false);
							}}
							onCancel={() => setPicking(false)}
						/>
					</div>
				) : (
					<div className="rounded-xl border border-line bg-surface-sunken p-3">
						<p className="text-2xs text-fg-subtle">Destination</p>
						<p className="mt-0.5 text-sm font-medium text-fg">
							{folderLabel(destination)}
						</p>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setPicking(true)}
							className="mt-2 px-0"
						>
							Move to a different folder
						</Button>
					</div>
				)}
			</div>

			<div className="space-y-2 border-t border-line bg-surface px-row-inset py-3">
				<p className="text-2xs text-fg-subtle">
					Moves these {count} {plural(count)} out of Spam to{" "}
					{folderLabel(destination)} now. Nothing later.
				</p>
				<Button
					variant="primary"
					onClick={onMove}
					className="h-11 w-full font-semibold"
				>
					Move {count} out of Spam
				</Button>
				<Button variant="ghost" onClick={onBack} className="h-11 w-full">
					Back
				</Button>
			</div>
		</div>
	);
}

function DoneStep({
	count,
	destination,
	onClose,
}: {
	count: number;
	destination: string;
	onClose: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex flex-1 flex-col items-center justify-center gap-3 px-row-inset py-10 text-center">
				<CheckCircle2 className="size-10 text-positive" aria-hidden />
				<p className="text-base font-semibold text-fg">
					Moved {count} {plural(count)} out of Spam.
				</p>
				<p className="text-2xs text-fg-subtle">
					You'll find them in {folderLabel(destination)}.
				</p>
			</div>
			<div className="border-t border-line bg-surface px-row-inset py-3">
				<Button
					variant="primary"
					onClick={onClose}
					className="h-11 w-full font-semibold"
				>
					Done
				</Button>
			</div>
		</div>
	);
}

export function RescueFromSpam() {
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<Step>("review");
	const [rescued, setRescued] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<Set<string>>(
		() => new Set(CANDIDATES.map((c) => c.id)),
	);
	const [destination, setDestination] = useState("inbox");
	const [movedCount, setMovedCount] = useState(0);

	const candidates = CANDIDATES.filter((c) => !rescued.has(c.id));
	const liveSpam = SPAM_NOISE;
	const selectedCount = selected.size;

	const openFlow = () => {
		setSelected(new Set(candidates.map((c) => c.id)));
		setDestination("inbox");
		setStep("review");
		setOpen(true);
	};

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const move = () => {
		setMovedCount(selectedCount);
		setRescued((prev) => {
			const next = new Set(prev);
			for (const id of selected) next.add(id);
			return next;
		});
		setStep("done");
	};

	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-surface">
			<div className="flex items-center gap-2 border-b border-line bg-surface px-row-inset py-2.5">
				<ShieldCheck className="size-4 text-fg-muted" aria-hidden />
				<span className="text-sm font-semibold text-fg">Spam</span>
				<span className="text-2xs text-fg-subtle">
					{candidates.length + liveSpam.length} messages
				</span>
			</div>

			{candidates.length > 0 && (
				<div className="px-row-inset pt-2">
					<RescueBanner count={candidates.length} onReview={openFlow} />
				</div>
			)}

			<div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto pt-2">
				{candidates.map((c) => (
					<div
						key={c.id}
						className="flex items-start gap-3 px-row-inset py-2.5"
					>
						<Avatar name={c.senderName} email={c.senderAddress} size="sm" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium text-fg-muted">
								{c.senderName}
							</p>
							<p className="truncate text-sm text-fg-muted">{c.subject}</p>
							<p className="line-clamp-1 text-xs text-fg-subtle">{c.snippet}</p>
						</div>
					</div>
				))}
				{liveSpam.map((s) => (
					<div
						key={s.address}
						className="flex items-start gap-3 px-row-inset py-2.5 opacity-70"
					>
						<Avatar name={s.sender} email={s.address} size="sm" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium text-fg-muted">
								{s.sender}
							</p>
							<p className="truncate text-sm text-fg-subtle">{s.subject}</p>
						</div>
					</div>
				))}
			</div>

			<BottomSheet
				open={open}
				onClose={() => setOpen(false)}
				dismissLabel="Close rescue"
			>
				{step === "review" && (
					<ReviewStep
						candidates={candidates}
						selected={selected}
						onToggle={toggle}
						onSelectAll={() =>
							setSelected(new Set(candidates.map((c) => c.id)))
						}
						onSelectNone={() => setSelected(new Set())}
						onContinue={() => setStep("destination")}
						onCancel={() => setOpen(false)}
					/>
				)}
				{step === "destination" && (
					<DestinationStep
						count={selectedCount}
						destination={destination}
						onPick={setDestination}
						onMove={move}
						onBack={() => setStep("review")}
					/>
				)}
				{step === "done" && (
					<DoneStep
						count={movedCount}
						destination={destination}
						onClose={() => setOpen(false)}
					/>
				)}
			</BottomSheet>
		</div>
	);
}
