import{j as e}from"./iframe-uufGNBEn.js";import{i as T}from"./filter-presets-CeVCfMxc.js";import{F as _}from"./filter-sheet-B1swY7oD.js";import{a as L,b as I,M as U,c as q}from"./message-list-state-CcVIcmRj.js";import{C as O}from"./message-row-yrY4apdT.js";import"./preload-helper-PPVm8Dsz.js";import"./brief-filters-B8HFYs3o.js";import"./cn-d2XQ1MEC.js";import"./row-keyboard-4SpR8O0u.js";import"./badge-DS2l7jE5.js";import"./button-Wi0n0Lyz.js";import"./circle-alert-Dg_Tz5Bw.js";import"./createLucideIcon-Bn-Stmx4.js";import"./loader-circle-qkSTSuP1.js";import"./keymap-dispatch-DTaqnLKC.js";import"./roving-focus-C30yPp50.js";import"./app-shell-types--0yhHeoL.js";import"./avatar-B5mDLuXx.js";import"./label-chip-ua_lHL4v.js";import"./message-settlement-BieSBZWI.js";import"./cloud-off-CdsVd9RG.js";import"./shield-alert-CwV1s3Qj.js";import"./star-Cwq7Iobx.js";import"./paperclip-BZCOJKRZ.js";import"./check-BSgP79ub.js";const C=["Alex Rivera","Priya Raman","Tom Okafor","Lena Fischer"];function k(r){const a=C[r%C.length]??C[0];return{id:`t${r}`,accountId:"a1",fromName:a,fromEmail:`${a.split(" ")[0]?.toLowerCase()}@example.com`,subject:`Q3 planning notes ${r}`,snippet:"Pushed the deck to the shared drive — have a look before Friday.",timeLabel:`9:${String(r%60).padStart(2,"0")}`,isRead:r%3===0,category:"personal"}}const Q={...k(1),fromName:"Netherlands Enterprise Agency, Subsidy and Permits Desk",subject:"Re: Re: Fwd: Consolidated quarterly reconciliation of the shared drive migration, including the appendices nobody asked for",snippet:"Following up on the earlier thread about the reconciliation, the appendices have been consolidated into a single document that now runs to sixty-two pages, and we would appreciate your review before the end of the week."},o={label:"Personal mail",reach:"whole-folder",onClear:()=>{}},s=r=>e.jsx("div",{className:"h-screen w-96 overflow-hidden border border-line",children:e.jsx(r,{})});function R({count:r,rows:a}){const j=a??Array.from({length:r??6},(M,A)=>k(A+1));return e.jsx("div",{className:"divide-y divide-line",children:j.map(M=>e.jsx(O,{thread:M},M.id))})}function t({category:r="personal",children:a}){const j=T();return e.jsx("div",{className:"flex h-full flex-col",children:e.jsx(_,{categories:j.categories,filters:j.filters,selectedCategory:r,activeFilters:new Set,expanded:!1,onSelectCategory:()=>{},onToggleFilter:()=>{},onClear:()=>{},onExpandedChange:()=>{},children:e.jsx("div",{className:"min-h-0 flex-1 overflow-y-auto",children:a})})})}function N(){return e.jsxs("div",{className:"flex h-screen w-full gap-4 p-4",children:[e.jsx("div",{className:"min-w-0 flex-1 overflow-hidden border border-line",children:e.jsx(L,{})}),e.jsx("div",{className:"min-w-0 flex-1 overflow-hidden border border-line",children:e.jsx(t,{children:e.jsx(L,{filter:o,scopeLabel:"Inbox"})})})]})}const me={title:"Screens/Kit/MessageListState",component:L,parameters:{layout:"fullscreen"},excludeStories:["EmptyStateComparison"]},P={decorators:[s]},n={decorators:[s],render:r=>e.jsx(t,{children:e.jsx(L,{...r})})},i={...P,args:{}},d={...P,args:{searchQuery:"invoice"}},c={...P,args:{scopeLabel:"Starred"}},l={...n,args:{filter:o,scopeLabel:"Inbox"}},p={...n,args:{filter:{...o,label:"unread mail"},scopeLabel:"Inbox"}},m={...n,args:{filter:{...o,label:"Personal unread mail with an attachment"},scopeLabel:"Inbox"}},h={...n,args:{filter:o,scopeLabel:"Inbox",searchQuery:"invoice"}},g={...n,args:{filter:{...o,reach:"loaded-pages"},scopeLabel:"Inbox"}},u={decorators:[s],args:{filter:{...o,label:"Unclassified mail"},scopeLabel:"Inbox"},render:r=>e.jsx(t,{category:"uncategorized",children:e.jsx(L,{...r})})},y={...n,args:{filter:{...o,label:"Transactional mail"},scopeLabel:"Archive/2024/Suppliers/Netherlands Enterprise Agency"}},f={render:()=>e.jsx(N,{})},b={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(U,{})})},x={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(R,{count:6})})},F={decorators:[s],render:()=>e.jsxs(t,{children:[e.jsx(R,{count:12}),e.jsx(q,{})]})},S={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(R,{count:60})})},w={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(R,{rows:[Q,...Array.from({length:4},(r,a)=>k(a+2))]})})},v={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(I,{message:"Request timed out while loading this mailbox.",onRetry:()=>{},onReport:()=>{}})})},E={decorators:[s],render:()=>e.jsx(t,{children:e.jsx(I,{message:"The IMAP server closed the connection while fetching message headers for this mailbox, after 30 seconds without a response to the SELECT command.",onRetry:()=>{},onReport:()=>{}})})};N.__docgenInfo={description:`The review this issue is for: an unfiltered empty mailbox next to a filtered
empty one. If these two ever look the same, the fix is invisible.

Both panels share the width instead of taking a fixed one, so neither can be
pushed off the edge of whatever frames the story. Rendered by the story below
and asserted by \`message-list-state.render.test.ts\`.`,methods:[],displayName:"EmptyStateComparison"};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  ...inPane,
  args: {}
}`,...i.parameters?.docs?.source},description:{story:`S1 — an empty mailbox with no filter. One plain line, no completeness claim:
nothing was narrowed, so there is nothing to reassure the reader about.`,...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  ...inPane,
  args: {
    searchQuery: "invoice"
  }
}`,...d.parameters?.docs?.source},description:{story:"S1 with a search query and no category filter — unchanged search copy.",...d.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  ...inPane,
  args: {
    scopeLabel: "Starred"
  }
}`,...c.parameters?.docs?.source},description:{story:`A collection that is not a mailbox names itself. Flagged spans accounts, so
"this mailbox" was never true for it; its own states are #310.`,...c.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: personalFilter,
    scopeLabel: "Inbox"
  }
}`,...l.parameters?.docs?.source},description:{story:`S2 — the state this slice exists for. The filter is active, the mailbox holds
no matching mail, and the list says the whole folder was checked so an empty
screen can no longer mean "we only looked at the newest page".`,...l.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: {
      ...personalFilter,
      label: "unread mail"
    },
    scopeLabel: "Inbox"
  }
}`,...p.parameters?.docs?.source},description:{story:`The narrowing is an attribute chip, or a token typed in the field, with no
category chosen. The list is filtered exactly as much as it is under a
category, and used to render as an empty collection instead (#1126).`,...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: {
      ...personalFilter,
      label: "Personal unread mail with an attachment"
    },
    scopeLabel: "Inbox"
  }
}`,...m.parameters?.docs?.source},description:{story:"Every dimension at once: category chip, attribute chip and typed token.",...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: personalFilter,
    scopeLabel: "Inbox",
    searchQuery: "invoice"
  }
}`,...h.parameters?.docs?.source},description:{story:"S2 with a search query on top of the filter — same completeness sentence.",...h.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: {
      ...personalFilter,
      reach: "loaded-pages"
    },
    scopeLabel: "Inbox"
  }
}`,...g.parameters?.docs?.source},description:{story:`A filter that could only be applied to the pages fetched so far claims only
that. D19-S3's case: the off-row criteria page with a continuation token, so
"every message was checked" would be a lie there.`,...g.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  args: {
    filter: {
      ...personalFilter,
      label: "Unclassified mail"
    },
    scopeLabel: "Inbox"
  },
  render: args => <FilteredShell category="uncategorized">
            <MessageListEmpty {...args} />
        </FilteredShell>
}`,...u.parameters?.docs?.source},description:{story:"The `Unclassified` chip's empty state. Unclassified mail is its own\nfilterable value and never reads as personal (issue #45), so this state is\nreachable and distinct from `FilteredEmpty`.",...u.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  ...inFilteredPane,
  args: {
    filter: {
      ...personalFilter,
      label: "Transactional mail"
    },
    scopeLabel: "Archive/2024/Suppliers/Netherlands Enterprise Agency"
  }
}`,...y.parameters?.docs?.source},description:{story:"Long filter and folder names — the copy wraps rather than overflowing.",...y.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  render: () => <EmptyStateComparison />
}`,...f.parameters?.docs?.source},description:{story:"Both empties side by side, full width — no pane frame to clip either one.",...f.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <MessageListLoading />
        </FilteredShell>
}`,...b.parameters?.docs?.source},description:{story:`S4 — the filter changed and pagination restarted. The skeleton, never the
previous predicate's rows and never an empty state.`,...b.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows count={6} />
        </FilteredShell>
}`,...x.parameters?.docs?.source},description:{story:"S5 — the filter is active and rows came back.",...x.parameters?.docs?.description}}};F.parameters={...F.parameters,docs:{...F.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows count={12} />
            <MessageListLoadingMore />
        </FilteredShell>
}`,...F.parameters?.docs?.source},description:{story:`S6 — rows already rendered, another page in flight. Words, not a bare
spinner: "not fetched yet" must not read as "nothing there".`,...F.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows count={60} />
        </FilteredShell>
}`,...S.parameters?.docs?.source},description:{story:"A filter that matches most of a large mailbox — scrolling, no truncation.",...S.parameters?.docs?.description}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <Rows rows={[longRow, ...Array.from({
      length: 4
    }, (_, i) => makeRow(i + 2))]} />
        </FilteredShell>
}`,...w.parameters?.docs?.source},description:{story:"Long subjects, senders and snippets under an active filter.",...w.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <MessageListError message="Request timed out while loading this mailbox." onRetry={() => undefined} onReport={() => undefined} />
        </FilteredShell>
}`,...v.parameters?.docs?.source},description:{story:"S7 — fail-hard error: the detail, a way back, and somewhere for it to go.",...v.parameters?.docs?.description}}};E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  decorators: [paneFrame],
  render: () => <FilteredShell>
            <MessageListError message="The IMAP server closed the connection while fetching message headers for this mailbox, after 30 seconds without a response to the SELECT command." onRetry={() => undefined} onReport={() => undefined} />
        </FilteredShell>
}`,...E.parameters?.docs?.source},description:{story:"A long underlying failure message still wraps inside the frame.",...E.parameters?.docs?.description}}};const he=["EmptyStateComparison","EmptyMailbox","EmptyMailboxSearching","NamedCollectionEmpty","FilteredEmpty","FilteredEmptyAttributeOnly","FilteredEmptyEveryNarrowing","FilteredEmptySearching","FilteredEmptyBoundedReach","FilteredEmptyUnclassified","FilteredEmptyLongLabels","EmptyVersusFilteredEmpty","FilterChangedRestarting","FilteredWithResults","FilteredFetchingMore","FilteredManyResults","FilteredLongContent","ErrorState","ErrorStateLongMessage"];export{i as EmptyMailbox,d as EmptyMailboxSearching,N as EmptyStateComparison,f as EmptyVersusFilteredEmpty,v as ErrorState,E as ErrorStateLongMessage,b as FilterChangedRestarting,l as FilteredEmpty,p as FilteredEmptyAttributeOnly,g as FilteredEmptyBoundedReach,m as FilteredEmptyEveryNarrowing,y as FilteredEmptyLongLabels,h as FilteredEmptySearching,u as FilteredEmptyUnclassified,F as FilteredFetchingMore,w as FilteredLongContent,S as FilteredManyResults,x as FilteredWithResults,c as NamedCollectionEmpty,he as __namedExportsOrder,me as default};
