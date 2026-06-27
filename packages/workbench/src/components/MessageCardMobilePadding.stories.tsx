import {
	Avatar,
	Button,
	IsolatedEmailFrame,
	MobileMessageActionBar,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BadgeCheck, ChevronDown, FolderInput } from "lucide-react";

const noop = () => undefined;

/**
 * The MOBILE inline-expanded card path (`MessageCard.ExpandedCard` →
 * `MessageBody` framed branch) used to reproduce and pin the fix for #763 —
 * "padding around mailbody" on a phone.
 *
 * The card structure is mirrored from `remit-web-client` (the card's `px-5 py-3`
 * wrapper, the header row, and the body wrapper), but the email itself renders
 * through the real kit `IsolatedEmailFrame` — change the card/body class strings
 * here in lockstep with the real component.
 *
 * The bug: the framed email box has ZERO internal padding, so a newsletter
 * whose own HTML carries no body padding renders its content flush to the box
 * border — a tighter gutter than the header content above it. The fix gives the
 * framed box internal padding so its content shares the header's gutter and
 * nothing is pinned to the border.
 */

// The sanitizer's layout-clamp block, prepended to the fixture exactly as the
// real pipeline does before handing HTML to IsolatedEmailFrame.
const LAYOUT_CLAMP_CSS = `<style>
html, body { margin: 0; padding: 0; max-width: 100%; }
body { overflow-wrap: anywhere; word-break: break-word; }
img, video, iframe, svg, canvas { max-width: 100% !important; height: auto; }
table { max-width: 100% !important; table-layout: auto; }
td, th { max-width: 100% !important; }
* { min-width: 0; }
</style>`;

// Reporter-style newsletter: a FULL-WIDTH hero image (edge to edge, no author
// padding around it), a heading, body copy, and a pink call-to-action button —
// mirroring the "Nederlands Philharmonisch / Koop nu kaarten" mail. Crucially
// the email's own root has NO horizontal padding, so its content sits flush to
// the frame edge unless the app frame supplies it.
const HERO = `data:image/svg+xml;utf8,${encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240">
		<rect width="600" height="240" fill="#1d1d2b"/>
		<circle cx="300" cy="120" r="70" fill="#e23a78"/>
		<rect x="0" y="200" width="600" height="40" fill="#11111a"/>
	</svg>`,
)}`;

const NEWSLETTER_HTML = `
<div style="font-family: Helvetica, Arial, sans-serif; color: #1a1a1a;">
	<img src="${HERO}" alt="Concert hero" width="600" style="display:block;width:100%;height:auto;" />
	<h1 style="font-size: 22px; margin: 16px 0 8px;">Nederlands Philharmonisch Orkest</h1>
	<p style="margin: 0 0 12px; line-height: 1.5;">Beleef het nieuwe seizoen vol
	symfonische hoogtepunten. Van Mahler tot Sjostakovitsj &mdash; onze musici nemen u
	mee op een onvergetelijke muzikale reis door het Concertgebouw.</p>
	<p style="margin: 0 0 20px; line-height: 1.5;">De kaartverkoop is nu geopend.
	Wees er snel bij, want de populairste concerten zijn vaak binnen enkele dagen
	uitverkocht.</p>
	<a href="https://example.com" style="display:inline-block;background:#e23a78;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;">Koop nu kaarten</a>
</div>
`;

interface CardProps {
	/** When true, render the framed body with internal padding (the #763 fix). */
	fixed: boolean;
}

// Framed-box wrapper class strings, kept in lockstep with MessageBody.tsx.
//
// BEFORE: the bordered card with no internal padding — content flush to the
// border (#763 as reported).
// AFTER (MessageBody's "inline" variant on the mobile expanded card): `p-3` for
// the gutter, and the border + tinted background dropped so the email doesn't
// read as a box-in-a-box inside the surrounding card — it sits cleanly on the
// card canvas while its content still aligns with the header gutter.
const FRAMED_BEFORE =
	"w-full max-w-full overflow-x-auto rounded-sm border border-line bg-surface-sunken";
const FRAMED_AFTER = "w-full max-w-full overflow-x-auto p-3";

/** MessageBody's framed branch wrapping the real kit `IsolatedEmailFrame`.
 *  `fixed` toggles the #763 internal padding on the framed box. */
function FramedBody({ fixed }: CardProps) {
	return (
		<div className={fixed ? FRAMED_AFTER : FRAMED_BEFORE}>
			<IsolatedEmailFrame
				html={`${LAYOUT_CLAMP_CSS}${NEWSLETTER_HTML}`}
				variant="framed"
				isDark={false}
			/>
		</div>
	);
}

/** Mirror of MessageCard.ExpandedCard on mobile: `px-5 py-3` wrapper, header row
 *  with avatar + sender/date (no duplicate star/kebab — the per-message bar owns
 *  the verbs), then the `MobileMessageActionBar`, then the `mt-3` framed body. */
function ExpandedCard({ fixed }: CardProps) {
	return (
		<div className="bg-canvas text-fg">
			<div className="px-5 py-3">
				<div className="flex items-start gap-3">
					<Avatar name="Nederlands Philharmonisch" size="md" />
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline justify-between gap-2">
							<span className="text-sm font-semibold text-fg">
								Nederlands Philharmonisch
								<BadgeCheck className="inline-block size-4 ml-1 -mt-0.5 text-positive align-middle" />
							</span>
							<div className="flex items-center gap-1 shrink-0">
								<span className="text-2xs text-fg-subtle">June 18, 2026</span>
								<ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
							</div>
						</div>
						<div className="text-xs text-fg-subtle">To you</div>
					</div>
				</div>
				<div className="mt-3 -mx-5">
					<MobileMessageActionBar
						hasThread
						onReply={noop}
						onReplyAll={noop}
						onForward={noop}
						onToggleStar={noop}
						onDelete={noop}
						onToggleRead={noop}
						moveSlot={
							<Button
								variant="ghost"
								size="sm"
								icon={<FolderInput className="size-5" />}
								aria-label="Move to folder"
								title="Move to folder"
								className="min-h-11 min-w-11 px-0"
							/>
						}
					/>
				</div>
				<div className="mt-3">
					<FramedBody fixed={fixed} />
				</div>
			</div>
		</div>
	);
}

const meta: Meta<CardProps> = {
	title: "Components/MessageCard Mobile Padding",
	component: ExpandedCard,
	parameters: { layout: "fullscreen", theme: "light" },
};
export default meta;

type Story = StoryObj<CardProps>;

/** #763 BEFORE: at 411px the framed email box has no internal padding, so the
 *  newsletter content sits flush to the box border — a tighter gutter than the
 *  header content above. */
export const MobileBefore: Story = {
	args: { fixed: false },
	render: (args) => (
		<div style={{ width: 411, margin: "0 auto", border: "1px solid #ccc" }}>
			<ExpandedCard {...args} />
		</div>
	),
};

/** #763 AFTER: the framed box gets internal padding so its content shares the
 *  same gutter as the header, and nothing is flush to the border. */
export const MobileAfter: Story = {
	args: { fixed: true },
	render: (args) => (
		<div style={{ width: 411, margin: "0 auto", border: "1px solid #ccc" }}>
			<ExpandedCard {...args} />
		</div>
	),
};
