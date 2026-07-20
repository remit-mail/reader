// Re-exported so a consumer can compose useLongPress's longPressProps with its
// own DOM props (its pressProps include an onClick react-aria uses for its
// own bookkeeping; a plain object spread silently drops one side's handler
// instead of chaining them) without importing react-aria directly.
export { mergeProps } from "react-aria";
export {
	AddressDisplay,
	type AddressDisplayProps,
	AddressList,
	type AddressListProps,
	type EnvelopeAddress,
} from "./components/address-display.js";
export { AddressTag, type AddressTagProps } from "./components/address-tag.js";
export {
	AppPasswordHint,
	type AppPasswordHintProps,
} from "./components/app-password-hint.js";
export { AppShell } from "./components/app-shell.js";
export {
	type AppShellLayoutContext,
	AppShellSlotted,
	type AppShellSlottedProps,
	useAppShellLayout,
} from "./components/app-shell-slotted.js";
export {
	type AppShellProps,
	type BriefCategoryFilter,
	briefCategories,
	categoryTone,
	type Density,
	INTELLIGENCE_MIN_WIDTH,
	type NarrowView,
	type NavAccount,
	type NavAccountStatus,
	type NavLinkComponent,
	type NavLinkRenderProps,
	type NavMailbox,
	type NavMailboxRole,
	type PaneLayout,
	READING_PANE_MIN_WIDTH,
	resolvePaneLayout,
	type ThreadCategory,
	type ThreadData,
	type ThreadMessageData,
	type ThreadRowData,
	type ThreadSection,
	type TouchSeed,
	useContainerWidth,
} from "./components/app-shell-types.js";
export { AppTopBar, type AppTopBarProps } from "./components/app-top-bar.js";
export { AuthCard, type AuthCardProps } from "./components/auth-card.js";
export {
	AuthFooter,
	type AuthFooterProps,
	COGNITO_FOOTER_NOTE,
} from "./components/auth-footer.js";
export { AuthHero, type AuthHeroProps } from "./components/auth-hero.js";
export {
	AutoMovedBadge,
	type AutoMovedBadgeProps,
} from "./components/auto-moved-badge.js";
export { Avatar, type AvatarProps } from "./components/avatar.js";
export { Badge, type BadgeProps } from "./components/badge.js";
export {
	Banner,
	type BannerProps,
	type BannerTone,
	type BannerVariant,
} from "./components/banner.js";
export {
	BottomSheet,
	type BottomSheetProps,
} from "./components/bottom-sheet.js";
export {
	BriefSection,
	type BriefSectionProps,
	SECTION_ROW_CAP,
} from "./components/brief-section.js";
export {
	BriefSections,
	type BriefSectionsProps,
} from "./components/brief-sections.js";
export {
	Button,
	ButtonLink,
	type ButtonLinkProps,
	type ButtonProps,
} from "./components/button.js";
export {
	Card,
	CardBody,
	CardHeader,
	type CardProps,
	CardTitle,
} from "./components/card.js";
export {
	CategoryBadge,
	type CategoryBadgeProps,
	getCategoryLabel,
	type MessageCategory,
} from "./components/category-badge.js";
export { Checkbox, type CheckboxProps } from "./components/checkbox.js";
export {
	ComposeActionBar,
	type ComposeActionBarProps,
	type ComposeSaveStatus,
} from "./components/compose-action-bar.js";
export {
	ComposeFormShell,
	type ComposeFormShellProps,
	type ComposeMode,
	composeModeLabels,
} from "./components/compose-form-shell.js";
export {
	DangerZoneSection,
	type DangerZoneSectionProps,
} from "./components/danger-zone-section.js";
export { Dialog, type DialogProps } from "./components/dialog.js";
export type { EmailFrameVariant } from "./components/email-frame-css.js";
export {
	FieldLabel,
	type FieldLabelProps,
} from "./components/field-label.js";
export {
	FilterSheet,
	type FilterSheetCategory,
	type FilterSheetFilter,
	type FilterSheetProps,
	type FilterSheetSource,
} from "./components/filter-sheet.js";
export {
	canonicalRoleLabel,
	type FolderRole,
	isVirtualFolderRole,
	provenanceFolderLabel,
	providerLeaf,
	type ResultFolder,
	roleIcon,
} from "./components/folder-role.js";
export {
	Input,
	type InputProps,
	type InputVariant,
} from "./components/input.js";
export {
	type AuthenticityIntel,
	type IntelligenceData,
	IntelligencePanel,
	type IntelligencePanelProps,
	type IntelligenceQuickActions,
	type MatchedChunk,
	type SenderFlagsIntel,
	type SenderIntel,
	type SenderTrustLevel,
	type SimilarMessageIntel,
	type SimilarMessageLinkComponent,
	type SimilarMessageLinkProps,
	type SimilarState,
} from "./components/intelligence-panel.js";
export {
	IntelligenceToggle,
	type IntelligenceToggleProps,
} from "./components/intelligence-toggle.js";
export {
	IsolatedEmailFrame,
	type IsolatedEmailFrameProps,
	measureContentAxis,
} from "./components/isolated-email-frame.js";
export { Kbd, type KbdProps } from "./components/kbd.js";
export {
	defaultKeyboardHints,
	type KeyboardHint,
	KeyboardHintBar,
	type KeyboardHintBarProps,
} from "./components/keyboard-hint-bar.js";
export { ListItem, type ListItemProps } from "./components/list-item.js";
export {
	type MailAction,
	MailActionToolbar,
	type MailActionToolbarProps,
} from "./components/mail-action-toolbar.js";
export {
	MailHeader,
	type MailHeaderProps,
} from "./components/mail-header.js";
export {
	type EmailRenderCategory,
	MessageBodyView,
	type MessageBodyViewProps,
} from "./components/message-body-view.js";
export {
	MessageHeader,
	type MessageHeaderProps,
} from "./components/message-header.js";
export { MessageListPane } from "./components/message-list-pane.js";
export {
	type ListState,
	MessageListEmpty,
	MessageListError,
	MessageListLoading,
} from "./components/message-list-state.js";
export {
	type BriefRowComponent,
	ComfortableRow,
	ComfortableRowBody,
	ComfortableRowTextContent,
	CompactRow,
	CompactRowBody,
	comfortableRowClass,
	compactRowClass,
} from "./components/message-row.js";
export {
	type MobileMessageAction,
	MobileMessageActionBar,
	type MobileMessageActionBarProps,
} from "./components/mobile-message-action-bar.js";
export {
	type MobileReadingMessageActions,
	MobileReadingPane,
	type MobileReadingPaneProps,
} from "./components/mobile-reading-pane.js";
export {
	MobileSearchView,
	type MobileSearchViewProps,
} from "./components/mobile-search-view.js";
export {
	type MoveMailboxOption,
	MoveMailboxPicker,
	type MoveMailboxPickerLabels,
	type MoveMailboxPickerProps,
} from "./components/move-mailbox-picker.js";
export {
	NavSidebar,
	type NavSidebarProps,
} from "./components/nav-sidebar.js";
export { OutboxRow, type OutboxRowProps } from "./components/outbox-row.js";
export {
	type OutboxStatus,
	OutboxStatusBadge,
	type OutboxStatusBadgeProps,
	outboxStatusConfig,
} from "./components/outbox-status-badge.js";
export {
	PopoverMenu,
	type PopoverMenuItem,
	type PopoverMenuProps,
} from "./components/popover-menu.js";
export {
	ProgressBar,
	type ProgressBarProps,
} from "./components/progress-bar.js";
export {
	PullToRefresh,
	type PullToRefreshProps,
} from "./components/pull-to-refresh.js";
export {
	QuarantineBugDialog,
	type QuarantineBugDialogProps,
} from "./components/quarantine-bug-dialog.js";
export {
	QuarantineEntryRow,
	type QuarantineEntryRowProps,
} from "./components/quarantine-entry-row.js";
export { quarantineDemoEntries } from "./components/quarantine-fixtures.js";
export {
	formatQuarantineReport,
	QUARANTINE_REPORT_DISCLAIMER,
	type QuarantineEntry,
	type QuarantineFailureCode,
	type QuarantineFailureStage,
	type QuarantineMimeNode,
	type QuarantineReportSections,
	quarantineIssueTitle,
	quarantineReportSections,
	quarantineSummary,
} from "./components/quarantine-report.js";
export {
	QuarantineSection,
	type QuarantineSectionProps,
} from "./components/quarantine-section.js";
export {
	QuotedText,
	type QuotedTextProps,
} from "./components/quoted-text.js";
export {
	CollapsedMessage,
	ExpandedMessage,
	ReadingPane,
} from "./components/reading-pane.js";
export {
	ReadingPaneEmpty,
	type ReadingPaneEmptyProps,
} from "./components/reading-pane-empty.js";
export {
	RescueBanner,
	type RescueBannerProps,
} from "./components/rescue-banner.js";
export {
	type RescueCandidate,
	RescueCandidateRow,
	type RescueCandidateRowProps,
} from "./components/rescue-candidate-row.js";
export {
	RescueFromSpamFlow,
	type RescueFromSpamFlowProps,
	rescueMoveConsequence,
} from "./components/rescue-from-spam-flow.js";
export {
	type GroupSelectionState,
	groupRescueCandidatesBySender,
	type RescueSenderGroup,
	RescueSenderGroupRow,
	type RescueSenderGroupRowProps,
	senderGroupSelectionState,
} from "./components/rescue-sender-group.js";
export {
	type PanelGroupProps,
	type PanelProps,
	type PanelResizeHandleProps,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "./components/resizable.js";
export {
	APPOINTABLE_ROLES,
	type CandidateFolder,
	RoleAppointmentList,
	type RoleAppointmentListProps,
} from "./components/role-appointment-list.js";
export {
	type RowAction,
	RowActions,
	type RowActionsProps,
	type RowDestructiveAction,
} from "./components/row-actions.js";
export { SearchBar, type SearchBarProps } from "./components/search-bar.js";
export {
	type SearchChip,
	SearchChipInput,
	type SearchChipInputProps,
} from "./components/search-chip-input.js";
export {
	type SearchResult,
	SearchResultRow,
	type SearchResultRowProps,
	type SearchResultTone,
} from "./components/search-result-row.js";
export {
	partitionSpamResults,
	type SearchResultSection,
	SearchResults,
	type SearchResultsProps,
	type SearchScope,
} from "./components/search-results.js";
export {
	SearchChipRow,
	type SearchChipRowProps,
	type SearchChipTone,
	SearchTokenChip,
	type SearchTokenChipProps,
	SearchTokenChips,
	type SearchTokenChipsProps,
} from "./components/search-token-chip.js";
export {
	SecuritySelect,
	type SecuritySelectProps,
	type ServerSecurity,
	securityToApi,
} from "./components/security-select.js";
export {
	SegmentedControl,
	type SegmentedControlProps,
	type SegmentedOption,
} from "./components/segmented-control.js";
export { Select, type SelectProps } from "./components/select.js";
export {
	SelectionTopBar,
	type SelectionTopBarNotice,
	type SelectionTopBarNoticeAction,
	type SelectionTopBarProps,
} from "./components/selection-top-bar.js";
export {
	demoLogsCommand,
	demoRelease,
	formatRelativeCheck,
	formatReleaseDate,
	type ReleaseInfo,
	type SelfUpdateState,
	type SelfUpdateStatus,
	type UpdatePhase,
	updatePhaseLabel,
	updateWaitNote,
} from "./components/self-update.js";
export {
	SelfUpdateConfirmDialog,
	type SelfUpdateConfirmDialogProps,
} from "./components/self-update-confirm-dialog.js";
export {
	UpdateAvailableDot,
	type UpdateAvailableDotProps,
} from "./components/self-update-dot.js";
export {
	SelfUpdateProgressOverlay,
	type SelfUpdateProgressOverlayProps,
	SelfUpdateUnreachableScreen,
	type SelfUpdateUnreachableScreenProps,
} from "./components/self-update-progress-overlay.js";
export {
	SelfUpdateSection,
	type SelfUpdateSectionProps,
} from "./components/self-update-section.js";
export {
	type SenderGroupOption,
	SenderGroupSwitch,
	type SenderGroupSwitchProps,
} from "./components/sender-group-switch.js";
export {
	type SenderTrust,
	SenderTrustIndicator,
	type SenderTrustIndicatorProps,
	type SenderTrustVariant,
	selectSenderTrustVariant,
} from "./components/sender-trust-indicator.js";
export {
	AccountHealthCard,
	type AccountHealthCardProps,
	SenderFlagRow,
	type SenderFlagRowProps,
	type SettingsNavItem,
	SettingsShell,
	type SettingsShellProps,
} from "./components/settings-screen.js";
export {
	SlidePanel,
	type SlidePanelProps,
} from "./components/slide-panel.js";
export {
	SpamResultsOffer,
	type SpamResultsOfferProps,
} from "./components/spam-results-offer.js";
export {
	commitPeek,
	SwipeableRow,
	type SwipeableRowOpenProps,
	type SwipePeek,
} from "./components/swipeable-row.js";
export { TouchListBody } from "./components/touch-list.js";
export {
	CheckRow,
	type CheckRowProps,
	ConnectorTile,
	type ConnectorTileProps,
	ServerFields,
	type ServerFieldsProps,
	WizardShell,
	type WizardShellProps,
} from "./components/wizard.js";
export {
	briefFilterConfig,
	type FilterAccount,
	type FilterPreset,
	flaggedFilterConfig,
	inboxFilterConfig,
} from "./filter-presets.js";
export {
	buildCidResolver,
	type CidResolvableBodyPart,
	type CidResolver,
} from "./lib/cid-resolver.js";
export { cn } from "./lib/cn.js";
export { generateLayoutClampCSS } from "./lib/email-layout-clamp.js";
export {
	classifyEmailRenderTreatment,
	type EmailRenderTreatment,
} from "./lib/email-render-treatment.js";
export {
	createEmailSanitizer,
	detectAuthorBackground,
	type SanitizedEmail,
	type SanitizeOptions,
	sanitizeInlineStyle,
	sanitizeStyleElementCss,
} from "./lib/email-sanitizer.js";
export {
	type UseLongPressOptions,
	type UseLongPressResult,
	useLongPress,
} from "./lib/use-long-press.js";
