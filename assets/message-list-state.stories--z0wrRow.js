import{j as e}from"./iframe-zw88L4Mq.js";import{i as P}from"./filter-presets-DijoMGkm.js";import{F as I}from"./filter-sheet-oKRRHI_0.js";import{a as w,b as k,M as T,c as _}from"./message-list-state-DhE98Ms8.js";import{C as U}from"./message-row-CcCINhiH.js";import"./preload-helper-PPVm8Dsz.js";import"./brief-sections-C5_algbC.js";import"./roving-focus-5ii5MRPr.js";import"./app-shell-types-LVfosKXZ.js";import"./brief-section-Vk7RjgtA.js";import"./cn-yMAG7bfM.js";import"./chevron-down-D70ORMFZ.js";import"./createLucideIcon-AdIgPHc_.js";import"./row-keyboard-4SpR8O0u.js";import"./badge-Ee126ieB.js";import"./button-B3Yk1mOK.js";import"./circle-alert-CC5hBMsl.js";import"./loader-circle-C8k5aq3T.js";import"./avatar-CZJ-LrXe.js";import"./label-chip-DCJIAgrz.js";import"./shield-alert-C0MDecMU.js";import"./star-Dn8uDbft.js";import"./paperclip-CYiOVWYx.js";import"./check-DQN2CS7b.js";const R=["Alex Rivera","Priya Raman","Tom Okafor","Lena Fischer"];function M(r){const o=R[r%R.length]??R[0];return{id:`t${r}`,accountId:"a1",fromName:o,fromEmail:`${o.split(" ")[0]?.toLowerCase()}@example.com`,subject:`Q3 planning notes ${r}`,snippet:"Pushed the deck to the shared drive — have a look before Friday.",timeLabel:`9:${String(r%60).padStart(2,"0")}`,isRead:r%3===0,category:"personal"}}const q={...M(1),fromName:"Netherlands Enterprise Agency, Subsidy and Permits Desk",subject:"Re: Re: Fwd: Consolidated quarterly reconciliation of the shared drive migration, including the appendices nobody asked for",snippet:"Following up on the earlier thread about the reconciliation, the appendices have been consolidated into a single document that now runs to sixty-two pages, and we would appreciate your review before the end of the week."},a={label:"Personal",reach:"whole-folder",onClear:()=>{}},s=r=>e.jsx("div",{className:"h-screen w-96 overflow-hidden border border-line",children:e.jsx(r,{})});function E({count:r,rows:o}){const v=o??Array.from({length:r??6},(j,A)=>M(A+1));return e.jsx("div",{className:"divide-y divide-line",children:v.map(j=>e.jsx(U,{thread:j},j.id))})}function t({category:r="personal",children:o}){const v=P();return e.jsx("div",{className:"flex h-full flex-col",children:e.jsx(I,{categories:v.categories,filters:v.filters,selectedCategory:r,activeFilters:new Set,expanded:!1,onSelectCategory:()=>{},onToggleFilter:()=>{},onClear:()=>{},onExpandedChange:()=>{},children:e.jsx("div",{className:"min-h-0 flex-1 overflow-y-auto",children:o})})})}function N(){return e.jsxs("div",{className:"flex h-screen w-full gap-4 p-4",children:[e.jsx("div",{className:"min-w-0 flex-1 overflow-hidden border border-line",children:e.jsx(w,{})}),e.jsx("div",{className:"min-w-0 flex-1 overflow-hidden border border-line",children:e.jsx(t,{children:e.jsx(w,{filter:a,scopeLabel:"Inbox"})})})]})}const ce={title:"Screens/Kit/MessageListState",component:w,parameters:{layout:"fullscreen"},excludeStories:["EmptyStateComparison"]},C={decorators:[s]},L={decorators:[s],render:r=>e.jsx(t,{children:e.jsx(w,{...r})})},n={...C,args:{}},i={...C,args:{searchQuery:"invoice"}},d={...C,args:{scopeLabel:"Starred"}},c={...L,args:{filter:a,scopeLabel:"Inbox"}},l={...L,args:{filter:a,scopeLabel:"Inbox",searchQuery:"invoice"}},p={...L,args:{filter:{...a,reach:"loaded-pages"},scopeLabel:"Inbox"}},m={decorators:[s],args:{filter:{...a,label:"Unclassified"},scopeLabel:"Inbox"},render:r=>e.jsx(t,{category:"uncategorized",children:e.jsx(w,{...r})})},h={...L,args:{filter:{...a,label:"Transactional"},scopeLabel:"Archive/2024/Suppliers/Netherlands Enterprise Agency"}},g={render:()=>e.jsx(N,{})},u={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(T,{})})},f={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(E,{count:6})})},y={decorators:[s],render:()=>e.jsxs(t,{children:[e.jsx(E,{count:12}),e.jsx(_,{})]})},x={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(E,{count:60})})},b={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(E,{rows:[q,...Array.from({length:4},(r,o)=>M(o+2))]})})},F={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(k,{message:"Request timed out while loading this mailbox.",onRetry:()=>{},onReport:()=>{}})})},S={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(k,{message:"The IMAP server closed the connection while fetching message headers for this mailbox, after 30 seconds without a response to the SELECT command.",onRetry:()=>{},onReport:()=>{}})})};N.__docgenInfo={description:`The review this issue is for: an unfiltered empty mailbox next to a filtered
empty one. If these two ever look the same, the fix is invisible.

Both panels share the width instead of taking a fixed one, so neither can be
pushed off the edge of whatever frames the story. Rendered by the story below
and asserted by \`message-list-state.render.test.ts\`.`,methods:[],displayName:"EmptyStateComparison"};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  ...inPane,
  args: {}
}`,...n.parameters?.docs?.source},description:{story:`S1 — an empty mailbox with no filter. One plain line, no completeness claim:
nothing was narrowed, so there is nothing to reassure the reader about.`,...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  ...inPane,
  args: {
    searchQuery: "invoice"
  }
}`,...i.parameters?.docs?.source},description:{story:"S1 with a search query and no category filter — unchanged search copy.",...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  ...inPane,
  args: {
    scopeLabel: "Starred"
  }
}`,...d.parameters?.docs?.source},description:{story:`A collection that is not a mailbox names itself. Flagged spans accounts, so
"this mailbox" was never true for it; its own states are #310.`,...d.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: personalFilter,
    scopeLabel: "Inbox"
  }
}`,...c.parameters?.docs?.source},description:{story:`S2 — the state this slice exists for. The filter is active, the mailbox holds
no matching mail, and the list says the whole folder was checked so an empty
screen can no longer mean "we only looked at the newest page".`,...c.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: personalFilter,
    scopeLabel: "Inbox",
    searchQuery: "invoice"
  }
}`,...l.parameters?.docs?.source},description:{story:"S2 with a search query on top of the filter — same completeness sentence.",...l.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: {
      ...personalFilter,
      reach: "loaded-pages"
    },
    scopeLabel: "Inbox"
  }
}`,...p.parameters?.docs?.source},description:{story:`A filter that could only be applied to the pages fetched so far claims only
that. D19-S3's case: the off-row criteria page with a continuation token, so
"every message was checked" would be a lie there.`,...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  args: {
    filter: {
      ...personalFilter,
      label: "Unclassified"
    },
    scopeLabel: "Inbox"
  },
  render: args => <FilteredShell category="uncategorized">
            <MessageListEmpty {...args} />
        </FilteredShell>
}`,...m.parameters?.docs?.source},description:{story:"The `Unclassified` chip's empty state. Unclassified mail is its own\nfilterable value and never reads as personal (issue #45), so this state is\nreachable and distinct from `FilteredEmpty`.",...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: {
      ...personalFilter,
      label: "Transactional"
    },
    scopeLabel: "Archive/2024/Suppliers/Netherlands Enterprise Agency"
  }
}`,...h.parameters?.docs?.source},description:{story:"Long filter and folder names — the copy wraps rather than overflowing.",...h.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  render: () => <EmptyStateComparison />
}`,...g.parameters?.docs?.source},description:{story:"Both empties side by side, full width — no pane frame to clip either one.",...g.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <MessageListLoading />
        </FilteredShell>
}`,...u.parameters?.docs?.source},description:{story:`S4 — the filter changed and pagination restarted. The skeleton, never the
previous predicate's rows and never an empty state.`,...u.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows count={6} />
        </FilteredShell>
}`,...f.parameters?.docs?.source},description:{story:"S5 — the filter is active and rows came back.",...f.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows count={12} />
            <MessageListLoadingMore />
        </FilteredShell>
}`,...y.parameters?.docs?.source},description:{story:`S6 — rows already rendered, another page in flight. Words, not a bare
spinner: "not fetched yet" must not read as "nothing there".`,...y.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows count={60} />
        </FilteredShell>
}`,...x.parameters?.docs?.source},description:{story:"A filter that matches most of a large mailbox — scrolling, no truncation.",...x.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows rows={[longRow, ...Array.from({
      length: 4
    }, (_, i) => makeRow(i + 2))]} />
        </FilteredShell>
}`,...b.parameters?.docs?.source},description:{story:"Long subjects, senders and snippets under an active filter.",...b.parameters?.docs?.description}}};F.parameters={...F.parameters,docs:{...F.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <MessageListError message="Request timed out while loading this mailbox." onRetry={() => undefined} onReport={() => undefined} />
        </FilteredShell>
}`,...F.parameters?.docs?.source},description:{story:"S7 — fail-hard error: the detail, a way back, and somewhere for it to go.",...F.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <MessageListError message="The IMAP server closed the connection while fetching message headers for this mailbox, after 30 seconds without a response to the SELECT command." onRetry={() => undefined} onReport={() => undefined} />
        </FilteredShell>
}`,...S.parameters?.docs?.source},description:{story:"A long underlying failure message still wraps inside the frame.",...S.parameters?.docs?.description}}};const le=["EmptyStateComparison","EmptyMailbox","EmptyMailboxSearching","NamedCollectionEmpty","FilteredEmpty","FilteredEmptySearching","FilteredEmptyBoundedReach","FilteredEmptyUnclassified","FilteredEmptyLongLabels","EmptyVersusFilteredEmpty","FilterChangedRestarting","FilteredWithResults","FilteredFetchingMore","FilteredManyResults","FilteredLongContent","ErrorState","ErrorStateLongMessage"];export{n as EmptyMailbox,i as EmptyMailboxSearching,N as EmptyStateComparison,g as EmptyVersusFilteredEmpty,F as ErrorState,S as ErrorStateLongMessage,u as FilterChangedRestarting,c as FilteredEmpty,p as FilteredEmptyBoundedReach,h as FilteredEmptyLongLabels,l as FilteredEmptySearching,m as FilteredEmptyUnclassified,y as FilteredFetchingMore,b as FilteredLongContent,x as FilteredManyResults,f as FilteredWithResults,d as NamedCollectionEmpty,le as __namedExportsOrder,ce as default};
