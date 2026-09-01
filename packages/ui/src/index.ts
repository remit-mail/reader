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
	AgendaComposer,
	type AgendaComposerProps,
	AgendaPhraseField,
	type AgendaPhraseFieldProps,
	PhraseReading,
} from "./components/agenda-composer.js";
export {
	type AgendaDensity,
	AgendaFlow,
	type AgendaFlowProps,
	type AgendaScrollTarget,
} from "./components/agenda-flow.js";
export {
	AgendaDensityControl,
	type AgendaDensityControlProps,
	FreeTimeList,
	type FreeTimeListProps,
	NextUpCard,
	type NextUpCardProps,
	PositionMap,
	type PositionMapProps,
} from "./components/agenda-panels.js";
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
	isBriefCategory,
	isThreadCategory,
	type MessageListKeyboard,
	type MessageListSelection,
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
export {
	type AttachmentDownloadState,
	type AttachmentItem,
	AttachmentList,
	type AttachmentListProps,
} from "./components/attachment-list.js";
export {
	AttendeeList,
	type AttendeeListProps,
	AttendeeRow,
	type AttendeeRowProps,
	RsvpBadge,
	type RsvpBadgeProps,
} from "./components/attendee-row.js";
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
	BlockedReason,
	type BlockedReasonProps,
} from "./components/blocked-reason.js";
export {
	BottomSheet,
	type BottomSheetProps,
} from "./components/bottom-sheet.js";
export {
	BriefEmpty,
	type BriefEmptyProps,
	type BriefSyncProgress,
} from "./components/brief-empty.js";
export {
	BriefSection,
	type BriefSectionProps,
	SECTION_ROW_CAP,
} from "./components/brief-section.js";
export {
	type BriefCategoryControl,
	type BriefFilterControl,
	type BriefFilterId,
	type BriefFilterSurface,
	BriefSections,
	type BriefSectionsProps,
	type BriefSourceControl,
	isBriefFilterId,
	matchesBriefFilters,
} from "./components/brief-sections.js";
export {
	Button,
	ButtonLink,
	type ButtonLinkProps,
	type ButtonProps,
} from "./components/button.js";
export {
	CalendarClashStrip,
	type CalendarClashStripProps,
} from "./components/calendar-clash-strip.js";
export {
	CalendarEventChip,
	type CalendarEventChipProps,
} from "./components/calendar-event-chip.js";
export {
	CalendarEventChipContent,
	type CalendarEventChipContentProps,
} from "./components/calendar-event-chip-content.js";
export {
	CalendarGrid,
	type CalendarGridProps,
} from "./components/calendar-grid.js";
export {
	CalendarInviteCard,
	type CalendarInviteCardProps,
} from "./components/calendar-invite-card.js";
export {
	CalendarList,
	type CalendarListProps,
} from "./components/calendar-list.js";
export {
	CalendarParseBadge,
	type CalendarParseBadgeProps,
	calendarParseLabel,
	calendarParseNote,
} from "./components/calendar-parse-badge.js";
export {
	CalendarSlotOffers,
	type CalendarSlotOffersProps,
} from "./components/calendar-slot-offers.js";
export {
	CalendarSuggestionDeck,
	type CalendarSuggestionDeckProps,
} from "./components/calendar-suggestion-deck.js";
export {
	CalendarDateNav,
	type CalendarDateNavProps,
	CalendarViewSwitch,
	type CalendarViewSwitchProps,
	type SegmentOption,
	segmentClassName,
} from "./components/calendar-toolbar.js";
export {
	type AgendaParse,
	type CalendarAttendee,
	type CalendarClash,
	type CalendarColorId,
	type CalendarDay,
	type CalendarDescriptor,
	type CalendarEventData,
	type CalendarInvite,
	type CalendarInviteState,
	type CalendarParseMethod,
	type CalendarProposal,
	type CalendarSlotPick,
	type CalendarViewId,
	type ChoicePicks,
	calendarColorIds,
	type EventDraft,
	type EventSuggestion,
	type PhraseChoice,
	type PhraseChoiceOption,
	type RecurrenceScope,
	type RsvpState,
	type ZoneCertainty,
	type ZoneOption,
	type ZoneOptions,
} from "./components/calendar-types.js";
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
	type ComposeSaveState,
	type ComposeSendState,
} from "./components/compose-action-bar.js";
export {
	type AddressEntry,
	type ComposeAddressCommit,
	ComposeAddressField,
	type ComposeAddressFieldHandle,
	type ComposeAddressFieldProps,
	type ParsedAddressInput,
} from "./components/compose-address-field.js";
export { ComposeBodySkeleton } from "./components/compose-body-skeleton.js";
export {
	ComposeFormShell,
	type ComposeFormShellProps,
	type ComposeShellLayout,
} from "./components/compose-form-shell.js";
export {
	ComposeHeader,
	type ComposeHeaderProps,
	composeHeaderSummary,
} from "./components/compose-header.js";
export {
	ComposeLanguageSetting,
	type ComposeLanguageSettingProps,
} from "./components/compose-language-setting.js";
export {
	ComposeQuoteMissingBanner,
	type ComposeQuoteMissingBannerProps,
	type ComposeQuoteMode,
	composeQuoteMissingMessage,
	NO_QUOTABLE_BODY_FORWARD_MESSAGE,
	NO_QUOTABLE_BODY_REPLY_MESSAGE,
} from "./components/compose-quote-missing-banner.js";
export {
	ComposeSmtpMissingBanner,
	type ComposeSmtpMissingBannerProps,
	SMTP_MISSING_MESSAGE,
} from "./components/compose-smtp-missing-banner.js";
export {
	ComposeSubjectField,
	type ComposeSubjectFieldProps,
} from "./components/compose-subject-field.js";
export {
	ConfirmDialog,
	type ConfirmDialogProps,
} from "./components/confirm-dialog.js";
export {
	CustomRecurrenceDialog,
	type CustomRecurrenceDialogProps,
	CustomRecurrenceEditor,
	type CustomRecurrenceEditorProps,
} from "./components/custom-recurrence.js";
export {
	DangerZoneSection,
	type DangerZoneSectionProps,
} from "./components/danger-zone-section.js";
export { Dialog, type DialogProps } from "./components/dialog.js";
export {
	DialogBackdrop,
	type DialogBackdropProps,
} from "./components/dialog-backdrop.js";
export type {
	AuthorDeclarations,
	EmailFrameVariant,
} from "./components/email-frame-css.js";
export {
	EventDetail,
	type EventDetailProps,
} from "./components/event-detail.js";
export {
	EventCalendarField,
	EventEditor,
	type EventEditorLayout,
	type EventEditorProps,
	EventField,
	type EventFieldProps,
	EventGuestsField,
	EventLocationField,
	EventNotesField,
	EventRepeatField,
	EventTitleField,
	EventWhenField,
	endsBeforeStart,
} from "./components/event-editor.js";
export {
	EventEditorPane,
	type EventEditorPaneProps,
} from "./components/event-editor-pane.js";
export {
	EventQuickEntry,
	type EventQuickEntryProps,
} from "./components/event-quick-entry.js";
export {
	EventSuggestionCard,
	type EventSuggestionCardProps,
	settleZone,
	ZONE_UNSETTLED_REASON,
	type ZoneSettlement,
} from "./components/event-suggestion-card.js";
export {
	FieldLabel,
	type FieldLabelProps,
} from "./components/field-label.js";
export {
	AddChipButton,
	type AddChipButtonProps,
	ClauseChip,
	type ClauseChipProps,
	type ClauseDraft,
	ClauseEditor,
	type ClauseEditorProps,
	WidenChip,
	type WidenChipProps,
} from "./components/filter-clause-chip.js";
export {
	FilterPreviewCount,
	type FilterPreviewCountProps,
} from "./components/filter-preview-count.js";
export {
	type ClauseField,
	clauseFieldHint,
	clauseFieldLabel,
	clauseFieldOrder,
	commitBlockedReason,
	commitLabel,
	demoClauseSuggestions,
	demoFolders,
	demoLabels,
	demoRule,
	demoSenderFallbackRule,
	demoSubjectPrefillRule,
	demoVocabularyRule,
	type FilterRule,
	hasActiveWiden,
	type LabelOption,
	type MatchOperator,
	matchesBodyText,
	matchJoinWord,
	matchModeHint,
	matchModeLabel,
	matchOperatorLabel,
	type PreviewCount,
	previewCountSummary,
	previewSettledReason,
	type RuleClause,
	type RuleMatchMode,
	type RuleScope,
	type RuleWiden,
	ruleBlockedCopy,
	scopeLabel,
	UNCOUNTABLE_PREDICATE_REASON,
	unreadableBodyClauses,
	widenChipLabel,
} from "./components/filter-rule.js";
export {
	type ClauseEditState,
	FilterRuleEditor,
	type FilterRuleEditorProps,
} from "./components/filter-rule-editor.js";
export {
	FilterPanelProvider,
	FilterSheet,
	type FilterSheetCategory,
	type FilterSheetFilter,
	type FilterSheetProps,
	type FilterSheetSource,
	FilterToggle,
} from "./components/filter-sheet.js";
export {
	FlowScreen,
	type FlowScreenProps,
	FlowStepRail,
	type FlowStepRailProps,
} from "./components/flow-screen.js";
export {
	FolderManageActions,
	type FolderManageActionsProps,
} from "./components/folder-manage-actions.js";
export {
	FolderManager,
	type FolderManagerLabels,
	type FolderManagerProps,
	type ManagedFolder,
} from "./components/folder-manager.js";
export {
	FolderRenameDialog,
	type FolderRenameDialogProps,
} from "./components/folder-rename-dialog.js";
export {
	canonicalRoleLabel,
	type FolderRole,
	isVirtualFolderRole,
	provenanceFolderLabel,
	type ResultFolder,
	roleIcon,
} from "./components/folder-role.js";
export {
	FolderRow,
	type FolderRowProps,
} from "./components/folder-row.js";
export {
	type FolderTreeNode,
	FolderTreePicker,
	type FolderTreePickerLabels,
	type FolderTreePickerProps,
	type FolderTreeRow,
} from "./components/folder-tree-picker.js";
export {
	Input,
	type InputProps,
	type InputVariant,
} from "./components/input.js";
export {
	type CalendarDayEntry,
	type CalendarInviteIntel,
	type CalendarProseIntel,
	type CalendarSuggestionIntel,
	IntelligenceCalendar,
	type IntelligenceCalendarActions,
	type IntelligenceCalendarData,
	type IntelligenceCalendarProps,
} from "./components/intelligence-calendar.js";
export {
	type AuthenticityIntel,
	type IntelligenceCalendarSurface,
	type IntelligenceData,
	IntelligencePanel,
	type IntelligencePanelProps,
	type IntelligenceQuickActions,
	type IntelligenceTabId,
	type MatchedChunk,
	type SenderFlagsIntel,
	type SenderIntel,
	type SenderTrustLevel,
	type SimilarMessageIntel,
	type SimilarMessageLinkComponent,
	type SimilarMessageLinkProps,
	type SimilarState,
} from "./components/intelligence-panel.js";
export { IntelligenceSection } from "./components/intelligence-section.js";
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
	KeyboardHintBar,
	type KeyboardHintBarProps,
} from "./components/keyboard-hint-bar.js";
export {
	LabelChip,
	type LabelChipData,
	type LabelChipProps,
} from "./components/label-chip.js";
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
	MessageBodyRegion,
	MessageBodyView,
	type MessageBodyViewProps,
} from "./components/message-body-view.js";
export { MessageListPane } from "./components/message-list-pane.js";
export {
	type FilterReach,
	type ListState,
	MessageListEmpty,
	type MessageListEmptyProps,
	MessageListError,
	type MessageListFilter,
	MessageListLoading,
	MessageListLoadingMore,
} from "./components/message-list-state.js";
export {
	type BriefRowComponent,
	ComfortableRow,
	ComfortableRowBody,
	ComfortableRowLeading,
	ComfortableRowTextContent,
	CompactRow,
	CompactRowBody,
	comfortableRowClass,
	compactRowClass,
	type RowSelection,
	type RowToggleEvent,
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
export { NavLinkSurface } from "./components/nav-link-surface.js";
export {
	NavSidebar,
	type NavSidebarProps,
} from "./components/nav-sidebar.js";
export { NavToggleButton } from "./components/nav-toggle-button.js";
export {
	NewFolderAction,
	type NewFolderActionProps,
	type NewFolderProminence,
} from "./components/new-folder-action.js";
export {
	NewFolderForm,
	type NewFolderFormLabels,
	type NewFolderFormProps,
} from "./components/new-folder-form.js";
export { OutboxRow, type OutboxRowProps } from "./components/outbox-row.js";
export {
	type OutboxStatus,
	OutboxStatusBadge,
	type OutboxStatusBadgeProps,
	outboxStatusConfig,
} from "./components/outbox-status-badge.js";
export {
	PasswordInput,
	type PasswordInputProps,
} from "./components/password-input.js";
export {
	PopoverMenu,
	type PopoverMenuItem,
	PopoverMenuPanel,
	type PopoverMenuPanelProps,
	PopoverMenuPortal,
	type PopoverMenuProps,
	PopoverMenuRow,
	type PopoverMenuRowProps,
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
	RecurrenceScopePrompt,
	type RecurrenceScopePromptProps,
} from "./components/recurrence-scope-prompt.js";
export {
	RefreshButton,
	type RefreshButtonProps,
	type RefreshControlState,
} from "./components/refresh-button.js";
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
	WholePixelWidth,
} from "./components/resizable.js";
export {
	EMPTY_RICH_TEXT,
	type RichTextValue,
} from "./components/rich-text-value.js";
export {
	APPOINTABLE_ROLES,
	type CandidateFolder,
	FolderRolesHelp,
	type RoleAppointment,
	RoleAppointmentList,
	type RoleAppointmentListProps,
	type RoleAppointmentSource,
} from "./components/role-appointment-list.js";
export {
	type PromptAction,
	type PromptPhase,
	type PromptReason,
	RoleAppointmentPrompt,
	type RoleAppointmentPromptCopy,
	type RoleAppointmentPromptProps,
	roleAppointmentPromptCopy,
} from "./components/role-appointment-prompt.js";
export {
	type RowAction,
	RowActions,
	type RowActionsProps,
	type RowDestructiveAction,
} from "./components/row-actions.js";
export { SearchBar, type SearchBarProps } from "./components/search-bar.js";
export {
	type SearchCaretRequest,
	type SearchChip,
	SearchChipInput,
	type SearchChipInputProps,
	type SearchFieldSuggest,
} from "./components/search-chip-input.js";
export {
	DROPPED_SEMANTIC_COPY,
	droppedFacetsCopy,
	hasConversionNotice,
	makeFilterBlockedCopy,
	type SearchConversionNotice,
	scopedOutCopy,
} from "./components/search-conversion.js";
export {
	type SearchConversionNoticeProps,
	SearchConversionNoticeView,
} from "./components/search-conversion-notice.js";
export {
	type SearchResult,
	SearchResultRow,
	type SearchResultRowProps,
	type SearchResultTone,
} from "./components/search-result-row.js";
export {
	MakeFilterAction,
	type MakeFilterActionProps,
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
	type SelectionTopBarSelectAll,
} from "./components/selection-top-bar.js";
export {
	FolderStepBody,
	type FolderStepProps,
	FooterNav,
	type FooterNavProps,
	MatchStepBody,
	type MatchStepProps,
	NameStepBody,
	type NameStepProps,
	PropertiesStepBody,
	type PropertiesStepProps,
	ReviewStepBody,
	type ReviewStepProps,
	RuleStepBody,
	type RuleStepProps,
	RunFooter,
	RunStepBody,
	type RunStepProps,
	SelectionSample,
	type SelectionSampleProps,
	SelectionWizard,
	type SelectionWizardProps,
	type WizardMessage,
} from "./components/selection-wizard.js";
export {
	demoLogsCommand,
	demoRelease,
	demoRunId,
	formatRelativeCheck,
	formatReleaseDate,
	type ReleaseInfo,
	type SelfUpdateState,
	type SelfUpdateStatus,
	type UpdatePhase,
	type UpdateRunId,
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
	type ShellSearchScope,
	ShellTopBar,
	type ShellTopBarProps,
	type ShellTopBarSearch,
} from "./components/shell-top-bar.js";
export {
	SlidePanel,
	type SlidePanelProps,
} from "./components/slide-panel.js";
export {
	SpamResultsOffer,
	type SpamResultsOfferProps,
} from "./components/spam-results-offer.js";
export {
	type Suggestion,
	SuggestList,
	type SuggestListProps,
} from "./components/suggest-list.js";
export {
	commitPeek,
	SwipeableRow,
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
	sanitizeAdoptedHtml,
	sanitizeQuotedHtml,
} from "./lib/adopted-html.js";
export {
	type AgendaRow,
	addDays,
	type BusySpan,
	buildAgendaRows,
	buildCalendarDay,
	busyMinutesOf,
	busySpansOn,
	type ClashOptions,
	clashesWith,
	conflictsOf,
	DAY_END_MINUTE,
	DAY_START_MINUTE,
	datesBetween,
	FREE_MINUTES,
	type FreeStretch,
	formatMinute,
	formatRunLabel,
	formatShortDay,
	formatSpan,
	freeAhead,
	freeStretchesFromSpans,
	freeStretchesOn,
	groupOverlapping,
	isClearDay,
	isEmptyDay,
	minuteOfDay,
	monthLabel,
	type NextUp,
	readNextUp,
	shortMonthLabel,
	type WallSpan,
	wallSpanOn,
	weekdayLongLabel,
	weekdayShortLabel,
} from "./lib/agenda-time.js";
export {
	DEFAULT_ATTACHMENT_FILENAME,
	formatByteSize,
	sanitizeAttachmentFilename,
} from "./lib/attachment-file.js";
export {
	briefChipCategory,
	briefChipFilters,
	briefFilterHasTerm,
	briefQueryCategory,
	briefQueryFilters,
	briefQueryIsActive,
	clearBriefFiltersInQuery,
	setBriefCategoryInQuery,
	toggleBriefFilterInQuery,
} from "./lib/brief-filter-query.js";
export {
	type CalendarColorClasses,
	calendarColorClasses,
} from "./lib/calendar-color.js";
export {
	type CalendarEventShell,
	calendarEventBodyClasses,
} from "./lib/calendar-event-shell.js";
export {
	DRAFT_MINUTES,
	isDraggedSelection,
	pointPick,
	rangePick,
} from "./lib/calendar-slot-pick.js";
export {
	buildCidResolver,
	type CidResolvableBodyPart,
	type CidResolver,
} from "./lib/cid-resolver.js";
export { cn } from "./lib/cn.js";
export {
	browserSpellcheckHelp,
	COMPOSE_LANGUAGE_OPTIONS,
	type ComposeLanguageOption,
	defaultComposeLanguages,
	detectionCodeFor,
	languageChipLabel,
	languageLabel,
	primaryLanguageSubtag,
	unwrapLanguage,
	wrapWithLanguage,
} from "./lib/compose-language.js";
export { modeOfDraft } from "./lib/compose-mode.js";
export { generateLayoutClampCSS } from "./lib/email-layout-clamp.js";
export {
	classifyEmailRenderTreatment,
	type EmailRenderTreatment,
} from "./lib/email-render-treatment.js";
export {
	createEmailSanitizer,
	detectAuthorBackground,
	detectAuthorSpacing,
	type SanitizedEmail,
	type SanitizeOptions,
	sanitizeInlineStyle,
	sanitizeStyleElementCss,
} from "./lib/email-sanitizer.js";
export {
	addMinutesToClock,
	type PhraseParse,
	parseEventPhrase,
} from "./lib/event-phrase.js";
export {
	collapseFolderTree,
	filterFolderTree,
	folderAncestors,
	folderDepth,
	folderLeaf,
	folderParent,
	matchesQuery,
	orderFolderNodes,
	queryExpandedPaths,
	withCreateRows,
} from "./lib/folder-tree.js";
export {
	findFirstFocusable,
	findLastFocusable,
	findNextFocusable,
	findParentRow,
	isFocusable,
	isSelectable,
} from "./lib/folder-tree-focus.js";
export {
	defaultKeyboardHints,
	KEY_HINT_GROUPS,
	type KeyboardHint,
	type KeyHint,
	type KeyHintGroup,
	keyboardHintsFor,
	keysForAction,
	shortcutHintForAction,
	type TriageAction,
	type TriageHandlers,
	tooltipForAction,
} from "./lib/keymap.js";
export {
	type DispatchResult,
	dispatchKey,
	isControlTarget,
	isEditableTarget,
	type KeyStroke,
	ROW_ATTRIBUTE,
	type SequencePrefix,
} from "./lib/keymap-dispatch.js";
export {
	isLabelColorValue,
	type LabelColorValue,
	labelColorOptions,
	labelDotClass,
} from "./lib/label-color.js";
export {
	DESKTOP_MEDIA_QUERY,
	DESKTOP_MIN_WIDTH,
} from "./lib/layout-breakpoints.js";
export {
	type OverlayAnswers,
	type OverlayScopeOptions,
	overlayStack,
	resolveAgainstOverlays,
	useOverlayScope,
} from "./lib/overlay-scope.js";
export {
	derivePropertyClauses,
	normalizeSubject,
	sharedSubjectFragment,
} from "./lib/property-prefill.js";
export {
	type CustomRecurrence,
	dayOfMonthLabel,
	defaultCustomRecurrence,
	defaultEndDate,
	endDateLabel,
	formatCustomRecurrence,
	type MonthlyMode,
	NO_REPEAT,
	ordinalWeekdayLabel,
	type RecurrenceEnd,
	type RecurrenceUnit,
	readCustomRecurrence,
	repeatChoices,
	WEEKDAY_INITIALS,
	weekdayName,
} from "./lib/recurrence.js";
export {
	LIST_ROW_ATTRIBUTE,
	LIST_ROW_SELECTOR,
	type RovingOrientation,
	rovingNextIndex,
	type UseRovingFocusOptions,
	useRovingFocus,
} from "./lib/roving-focus.js";
export { type RuleNameParts, suggestRuleName } from "./lib/rule-name.js";
export {
	quoteSearchTokenValue,
	type SearchQueryWord,
	type SearchTermParts,
	searchTokenTerm,
	splitSearchTerm,
	splitSearchWords,
} from "./lib/search-query-words.js";
export {
	type DroppedFacet,
	type DroppedFacetType,
	isConvertible,
	type SearchConversion,
	searchConversionNotice,
} from "./lib/search-rule.js";
export {
	SEMANTIC_OFF_BUYS,
	SEMANTIC_OFF_COMMAND,
	SEMANTIC_OFF_TITLE,
	semanticOffReason,
} from "./lib/semantic-off.js";
export {
	collapsibleDomain,
	deriveSenderClauses,
	distinctSenders,
	dominantSender,
	senderDomain,
	senderLabel,
} from "./lib/sender-derivation.js";
export {
	type SuggestAction,
	type SuggestKeyState,
	suggestKeyAction,
} from "./lib/suggest-keys.js";
export { type ListCursor, useListCursor } from "./lib/use-list-cursor.js";
export {
	type ListKeyboard,
	type UseListKeyboardOptions,
	useListKeyboard,
} from "./lib/use-list-keyboard.js";
export {
	type UseLongPressOptions,
	type UseLongPressResult,
	useLongPress,
} from "./lib/use-long-press.js";
export { useMatchMedia } from "./lib/use-match-media.js";
export {
	MESSAGE_ROW_SELECTOR,
	useRenderedRowIds,
} from "./lib/use-rendered-row-ids.js";
export {
	computeRange,
	deriveIsMultiSelectMode,
	intersectSelectedIds,
	isModified,
	modifiersOf,
	nextFocusId,
	type RowSelectIntent,
	resolveRangeAnchor,
	rowSelectIntent,
	type SelectionModifiers,
	type UseSelectionOptions,
	useSelection,
} from "./lib/use-selection.js";
export {
	type ComboboxProps,
	type SuggestListState,
	type UseSuggestListInput,
	useSuggestList,
} from "./lib/use-suggest-list.js";
export { useTriageKeyboard } from "./lib/use-triage-keyboard.js";
export {
	backExits,
	clauseSentence,
	clauseWords,
	crossAccountDestinationReason,
	crossAccountRuleReason,
	crossFolderDestinationReason,
	crossFolderRuleReason,
	ESCALATED_MATCH_HINT,
	ESCALATED_REVIEW_WARNING,
	ESCALATED_SCOPE_FALLBACK,
	escalatedMatchLabel,
	type MatchCount,
	type MatchDescription,
	type MatchDoor,
	type MatchMode,
	matchDoorHint,
	matchDoorLabel,
	matchPhrase,
	matchSummary,
	type RunCopy,
	type RunOutcome,
	type RunState,
	runCopy,
	type SampleEmptyReason,
	type SelectionRestriction,
	type StepId,
	sampleEmptyCopy,
	stepBlockedReason,
	stepIndex,
	stepLabel,
	stepsFor,
	unreadableDraftClauses,
	type Verb,
	type VerbCopy,
	verbCopy,
	type WizardAnswers,
	type WizardDraft,
	type WizardScope,
	wizardScopeFor,
} from "./lib/wizard-steps.js";
