# Mobile Responsive — Research & Audit

Reference for the multi-PR responsive overhaul of `@remit/web-client`.

## Audit: starting state (commit `abb4e3a`)

- React 19 + TanStack Router + TanStack Query + Tailwind v4 + Vite 6.
- Tailwind theme is inline in `src/index.css` (no `tailwind.config.js`). Default breakpoints apply: `sm:640`, `md:768`, `lg:1024`, `xl:1280`, `2xl:1536`.
- **One** responsive class in the entire codebase (`src/components/ui/Badge.tsx`). Effectively desktop-only.
- Layout uses `react-resizable-panels` everywhere — fine on desktop, useless on phones (handles render at sub-pixel widths, panels never collapse).
- `MailLayout` (`src/routes/mail.tsx`): Header on top, then horizontal `ResizablePanelGroup` of [sidebar 15% | outlet 85%]. The outlet on `/mail/$mailboxId` itself splits [list 35% | conversation 65%], so we have three columns at 390px → none of them are usable (see `screenshots/before/mail.png`).
- `SettingsLayout` (`src/routes/settings.tsx`): hardcodes a `w-48` aside next to a `flex-1` main. Doesn't fit on phone width.
- `AuthShell` (`src/auth/AuthShell.tsx`): Amplify Authenticator wraps everything once Cognito is configured. Visual style of the signin form is set by `@aws-amplify/ui-react/styles.css`. We won't touch the signin form in v1 — Amplify's default is already mobile-okay.
- Compose: `FullCompose` (occupies the conversation pane) and `InlineCompose` (bottom of `ConversationView`). No FAB. Compose state is global via `ComposeProvider`.
- `ThreePanelLayout.tsx` is dead code — no imports.
- `sonner` toast lib is in `dependencies` but **not imported anywhere** — ban per `MEMORY/feedback_no_toasts.md`. Remove in cleanup.
- Playwright is wired (smoke + e2e configs). `expect(page).toHaveScreenshot()` is supported out of the box — the visual-regression PR plugs straight into the existing harness.
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">` is already in `index.html`. Good.

### Routes & layouts

| Route | File | Layout shape |
|---|---|---|
| `/` | `routes/index.tsx` | redirect → `/mail` |
| `/mail` | `routes/mail.tsx` | Header + sidebar + outlet (resizable) |
| `/mail/` | `routes/mail/index.tsx` | empty state |
| `/mail/$mailboxId` | `routes/mail/$mailboxId.tsx` | list + conversation (resizable) |
| `/mail/outbox` | `routes/mail/outbox.tsx` | single column list |
| `/settings` | `routes/settings.tsx` | header + nav aside + outlet |
| `/settings/` | `routes/settings/index.tsx` | redirect → `/settings/accounts` |
| `/settings/accounts` | `routes/settings/accounts.tsx` | content with side `SlidePanel` for forms |

## Patterns we adopt (from Gmail mobile, K-9 Mail, Material 3)

### Navigation

- **Below `md` (< 768px):** `MailLayout` collapses three panes to one. The currently-relevant pane is full-screen.
  - On `/mail/$mailboxId` with no thread selected: just the list.
  - On `/mail/$mailboxId?selectedMessageId=…`: just the conversation, with a back button in the header that returns to the list (clears `selectedMessageId`).
- **Hamburger → modal nav drawer:** the existing `Header` already has a hamburger; on mobile it opens a left-edge drawer (≤ 320px wide, scrim behind, escape/scrim/in-link tap dismisses). The drawer hosts the `MailSidebar` (accounts, mailboxes, drafts, outbox).
- **Bottom nav for top-level destinations:** Mail / Outbox / Settings as a 3-icon bottom bar visible only `< md`. Material 3 recommends 3–5 destinations.
- **Header collapses on mobile:** logo + hamburger left, search icon right that expands to full-width search on tap (instead of always-visible search input).

### Mailbox list row (`MessageListItem`)

K-9 / Gmail mobile patterns we keep:
- Sender, subject, snippet, date, unread dot, attachment icon — all already present.
- **Ensure each row is ≥ 56px tall on mobile** so it meets the WCAG 2.5.5 / Material 48dp touch-target floor. Current row is `py-2.5` ≈ 50px — bump on mobile to `py-3` (~60px).
- **Larger avatar/contact icon area** (currently no avatar; we keep it that way for v1 — adding avatars is a separate UX exercise).
- Hide the per-row checkbox on mobile (no hover, no bulk-select gesture for v1) — checkboxes appear after long-press in K-9, but we ship without long-press in v1.

### Thread / conversation view

- Full-screen on mobile, with a **back** button in a sticky top header that calls the existing `goBack` handler (clear `selectedMessageId`).
- Conversation header (subject + count) stays sticky.
- Message header collapses to one row on narrow widths; tap to expand (the existing `MessageCard` toggle stays).
- Action bar (Reply / Reply all / Forward) becomes a sticky bottom bar that doesn't compete with the bottom nav — bottom nav is **hidden when a thread is open** so the action bar is the only chrome (matches Gmail mobile).

### Compose

- **FAB on mobile** (≥ `md` it's hidden — desktop has compose buttons in sidebar / etc.). 56×56 rounded-full button bottom-right with 16px margin (Material 3 standard size). Hidden when a compose surface is already open.
- **Mobile compose = full-screen**: on `< md`, `FullCompose` covers the whole viewport (fixed inset-0, z-50). Header has a back/close arrow + send button. Body fields stack: From → To (collapsible Cc/Bcc) → Subject → Body.
- **Desktop compose** stays inline in the conversation pane (no regression).
- `InlineCompose` (reply/forward inside conversation) keeps its desktop behavior but on mobile becomes a full-screen takeover too — same `FullCompose` mode internally.

### Density / typography

- Bump base font from defaults to 16px on mobile to avoid iOS zoom-on-focus for inputs.
- Increase row vertical padding on `< md`; tighten back on `≥ md`.
- Touch targets (buttons, links, icon-only controls): minimum `min-h-11 min-w-11` (44px) on mobile.

## Skipped for v1 (future work)

- **Swipe-to-archive / swipe-to-delete** on message rows (K-9, Gmail). Needs gesture lib + design pass.
- **Pull-to-refresh.** TanStack Query handles refetch on focus; manual P2R is a separate UX project.
- **Long-press multi-select.** Bulk selection works on desktop via the existing checkbox-on-hover pattern; no mobile equivalent in v1.
- **Avatars / contact images.** Useful but separate effort.
- **Bottom-sheet menus** for per-row actions. We use the existing inline icon buttons.
- **`MessageActionMenu`** mobile redesign — keep current popover; revisit if it overflows.
- **iOS safe-area / `env(safe-area-inset-bottom)`** padding on bottom nav and FAB. Will wire if testing on a notch'd device shows clipping; otherwise follow-up.

## Visual-regression baselines (PR-D)

Routes captured at three viewports each (iPhone-13 390×844, iPad-mini 768×1024, desktop 1440×900):

1. `/signin` (Amplify form, when Cognito unconfigured — banner state)
2. `/mail` (default, no mailbox selected)
3. `/mail/$mailboxId` (list visible)
4. `/mail/$mailboxId?selectedMessageId=…` (thread open)
5. `/mail/outbox`
6. `/settings/accounts`

Compose flows are exercised by existing smoke tests; we add one screenshot of the empty compose form at mobile size.

## Sources

- [Material Design 3 — FAB sizing (56dp, 16dp margins)](https://m3.material.io/components/floating-action-button/specs)
- [Material Design 3 — Navigation drawer](https://m3.material.io/components/navigation-drawer/overview)
- [Material Design 3 — Navigation bar](https://m3.material.io/components/navigation-bar/overview)
- [WCAG 2.5.5 Target Size (44×44 CSS pixels)](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)
- [Tailwind CSS v4 default breakpoints](https://tailwindcss.com/docs/responsive-design)
- [Thunderbird for Android (K-9 Mail) — swipe actions, compose FAB, drawer nav](https://blog.thunderbird.net/2022/11/thunderbird-android-update-k-9-mail-6-400-adds-customizable-swipe-actions/)
- [K-9 Mail message-list polish & FAB collapse-on-scroll](https://blog.thunderbird.net/2023/04/thunderbird-for-android-k-9-mail-march-progress-report/)
