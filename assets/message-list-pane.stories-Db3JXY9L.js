import{j as e,r as d}from"./iframe-uufGNBEn.js";import{i as W}from"./filter-presets-CeVCfMxc.js";import{m as O}from"./brief-filters-B8HFYs3o.js";import{u as M}from"./use-list-keyboard-CEeF1JS9.js";import{F as P}from"./filter-sheet-B1swY7oD.js";import{M as $}from"./mail-header-CGFLQGCk.js";import{M as T}from"./message-list-pane-Ct9QrsMv.js";import{S as H}from"./selection-top-bar-B11m6sfp.js";import"./preload-helper-PPVm8Dsz.js";import"./keymap-dispatch-DTaqnLKC.js";import"./overlay-scope-DDGgBdDi.js";import"./cn-d2XQ1MEC.js";import"./row-keyboard-4SpR8O0u.js";import"./badge-DS2l7jE5.js";import"./button-Wi0n0Lyz.js";import"./search-bar-BGyf9Xgk.js";import"./search-chip-input-D-f0x4mh.js";import"./search-token-chip-DqTHOlIk.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";import"./search-DT0jdmVi.js";import"./menu-CpYLczHL.js";import"./roving-focus-C30yPp50.js";import"./app-shell-types--0yhHeoL.js";import"./brief-sections-CdyWQMOv.js";import"./brief-section-DvHJzvM1.js";import"./chevron-down-CGnGYV2L.js";import"./chevron-right-B0dowht5.js";import"./kbd-CQM-qRx6.js";import"./message-list-state-CcVIcmRj.js";import"./circle-alert-Dg_Tz5Bw.js";import"./loader-circle-qkSTSuP1.js";import"./message-row-yrY4apdT.js";import"./avatar-B5mDLuXx.js";import"./label-chip-ua_lHL4v.js";import"./message-settlement-BieSBZWI.js";import"./cloud-off-CdsVd9RG.js";import"./shield-alert-CwV1s3Qj.js";import"./star-Cwq7Iobx.js";import"./paperclip-BZCOJKRZ.js";import"./check-BSgP79ub.js";import"./touch-list-BwHPMHm3.js";import"./swipeable-row-JHtLyIzx.js";import"./index-kPMH9ZlQ.js";import"./index-8Sr_-kjb.js";import"./mail-DXm5QBOT.js";import"./mail-open-MzOq669C.js";import"./trash-2-RI1RlAl9.js";import"./refresh-cw-CTL6YCWO.js";import"./banner-D7bQEtJc.js";import"./checkbox-Dp2a0wRA.js";import"./minus-WgJswgYh.js";import"./popover-menu-B7ne2TDp.js";import"./progress-bar-DPUE27ne.js";import"./arrow-left-DtwNLaK2.js";import"./folder-input-BXRE0zDI.js";import"./sparkles-CHnxu8zM.js";const u=[{id:"today",label:"Today",threads:[{id:"t1",accountId:"a1",fromName:"Alex Rivera",fromEmail:"alex@example.com",subject:"Q3 planning notes",snippet:"Here are the notes from today's planning session.",timeLabel:"9:42",category:"personal"},{id:"t2",accountId:"a1",fromName:"Acme Billing",fromEmail:"billing@acme.com",subject:"Your invoice is ready",snippet:"Invoice #1042 is available to view.",timeLabel:"8:15",isRead:!0,category:"transactional"}]},{id:"earlier",label:"Earlier",threads:[{id:"t3",accountId:"a1",fromName:"Weekly Digest",fromEmail:"news@digest.com",subject:"This week in tech",snippet:"The top stories you might have missed.",timeLabel:"Mon",category:"newsletter",messageCount:3}]}],ze={title:"Screens/Kit/MessageListPane",component:T,parameters:{layout:"centered"},args:{listTitle:"Inbox",listMeta:"3 conversations",sections:u,onSelectThread:()=>{}}},l=t=>e.jsx("div",{className:"h-screen w-96 overflow-hidden border border-line",children:e.jsx(t,{})}),D=t=>e.jsx("div",{className:"overflow-hidden border border-line",style:{width:390,height:844},children:e.jsx(t,{})}),E={focusedId:void 0,handlers:{},ref:()=>{}};function R({briefFilters:t=!1}){const r=M({isDesktop:!0}),[m,p]=d.useState(new Set),h=u.map(a=>({...a,threads:a.threads.filter(n=>O(n,m))})).filter(a=>a.threads.length>0);return e.jsx(T,{listTitle:"Inbox",listMeta:"3 conversations",sections:t?h:u,flatList:!t,briefFilters:t,briefFilter:t?{activeFilters:m,onToggleFilter:a=>p(n=>{const s=new Set(n);return s.has(a)?s.delete(a):s.add(a),s}),onClearFilters:()=>p(new Set)}:void 0,isDesktop:!0,onSelectThread:()=>{},selection:r.selection,keyboard:r.keyboard})}const I={render:()=>e.jsx(R,{}),decorators:[l]},C={args:{isDesktop:!1,flatList:!0},decorators:[D]},N={render:()=>e.jsx(R,{briefFilters:!0}),decorators:[l]};function B({initialExpanded:t=!1}){const r=W(),[m,p]=d.useState(""),[h,a]=d.useState(!1),[n,s]=d.useState(t),[f,x]=d.useState("all"),[L,o]=d.useState(new Set),i=u.flatMap(c=>c.threads);return e.jsxs("div",{className:"flex h-full flex-col",children:[e.jsx($,{title:"Inbox",unreadCount:3,isDesktop:!1,onMenuClick:()=>{},searchValue:m,onSearchChange:p,searchOpen:h,onSearchOpenChange:a}),e.jsx("div",{className:"min-h-0 flex-1",children:e.jsx(P,{categories:r.categories,filters:r.filters,sources:r.sources,selectedCategory:f,activeFilters:L,expanded:n,onExpandedChange:s,onSelectCategory:x,onToggleFilter:c=>o(A=>{const j=new Set(A);return j.has(c)?j.delete(c):j.add(c),j}),onClear:()=>{x("all"),o(new Set)},children:e.jsx("ul",{className:"divide-y divide-line",children:i.map(c=>e.jsxs("li",{className:"px-row-inset py-2.5",children:[e.jsx("div",{className:"text-sm font-medium text-fg",children:c.fromName}),e.jsx("div",{className:"truncate text-xs text-fg-muted",children:c.subject})]},c.id))})})})]})}const b={render:()=>e.jsx(B,{}),decorators:[D]},g={render:()=>e.jsx(B,{initialExpanded:!0}),decorators:[D]},y={args:{isDesktop:!0,flatList:!0,keyboard:E,listBody:e.jsx("div",{className:"flex-1 overflow-y-auto divide-y divide-line",children:u.flatMap(t=>t.threads.map(r=>e.jsxs("a",{href:`/mail/mbx-1/thr-${r.id}/${r.id}`,className:"flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken",children:[e.jsx("span",{className:"font-medium text-sm",children:r.fromName}),e.jsx("span",{className:"text-sm text-fg-muted truncate",children:r.subject})]},r.id)))})},decorators:[l]};function K({isDesktop:t}){const[r,m]=d.useState(new Set),[p,h]=d.useState(new Set),a=u.map(o=>({...o,threads:o.threads.filter(i=>!r.has(i.id)).map(i=>p.has(i.id)?{...i,isRead:!0}:i)})),n=M({isDesktop:t}),{selection:s}=n.cursor,{orderedIds:f}=n,x=f.length>0&&f.every(o=>s.selectedIds.has(o)),L=o=>{o(s.selectedIds),s.clearSelection()};return e.jsx(T,{listTitle:"Inbox",listMeta:"3 conversations",sections:a,flatList:!0,isDesktop:t,onSelectThread:()=>{},selection:n.selection,keyboard:n.keyboard,selectionBar:e.jsx(H,{title:"Inbox",count:s.selectedCount,onCancel:s.clearSelection,onDelete:()=>L(o=>m(i=>new Set([...i,...o]))),onMarkRead:()=>L(o=>h(i=>new Set([...i,...o]))),selectAll:{checked:x,indeterminate:s.hasSelection&&!x,onChange:()=>s.toggleAll(f)}})})}const S={render:()=>e.jsx(K,{isDesktop:!0}),decorators:[l]},w={render:()=>e.jsx(K,{isDesktop:!1}),decorators:[D]},k={args:{isDesktop:!0,flatList:!0,listState:"empty",keyboard:E},decorators:[l]},v={args:{isDesktop:!0,flatList:!0,listState:"empty",keyboard:E,listFilter:{label:"Personal mail",reach:"whole-folder",onClear:()=>{}},listScopeLabel:"Inbox"},decorators:[l]},F={args:{isDesktop:!0,flatList:!0,listState:"error",keyboard:E,errorMessage:"Request timed out while loading this mailbox.",onRetry:()=>{},onReportError:()=>{}},decorators:[l]};I.parameters={...I.parameters,docs:{...I.parameters?.docs,source:{originalSource:`{
  render: () => <LiveList />,
  decorators: [desktopFrame]
}`,...I.parameters?.docs?.source}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: false,
    flatList: true
  },
  decorators: [narrowFrame]
}`,...C.parameters?.docs?.source}}};N.parameters={...N.parameters,docs:{...N.parameters?.docs,source:{originalSource:`{
  render: () => <LiveList briefFilters />,
  decorators: [desktopFrame]
}`,...N.parameters?.docs?.source}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  render: () => <InboxScreen />,
  decorators: [narrowFrame]
}`,...b.parameters?.docs?.source},description:{story:"Inbox filter collapsed: header + the FilterSheet bar over the inbox list.",...b.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  render: () => <InboxScreen initialExpanded />,
  decorators: [narrowFrame]
}`,...g.parameters?.docs?.source},description:{story:"Inbox filter expanded: categories + Unread/Flagged/Has attachment.",...g.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: true,
    flatList: true,
    keyboard: noKeyboard,
    listBody: <div className="flex-1 overflow-y-auto divide-y divide-line">
                {sections.flatMap(s => s.threads.map(t => <a key={t.id} href={\`/mail/mbx-1/thr-\${t.id}/\${t.id}\`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken">
                            <span className="font-medium text-sm">{t.fromName}</span>
                            <span className="text-sm text-fg-muted truncate">
                                {t.subject}
                            </span>
                        </a>))}
            </div>
  },
  decorators: [desktopFrame]
}`,...y.parameters?.docs?.source},description:{story:"Consumer-supplied `listBody` slot — the pane renders the chrome while the\n caller owns the scrollable rows, and the keys over those rows with them.\n This models the web-client's virtualized inbox path.",...y.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  render: () => <SelectableList isDesktop />,
  decorators: [desktopFrame]
}`,...S.parameters?.docs?.source},description:{story:`The pane under a selection its consumer owns — it draws the checkboxes and
holds none of the state. Click a checkbox to tick one row, cmd/ctrl-click a
row to tick it without opening it, shift-click to range from the last row
touched, and select-all covers the rows on screen. From 768px up the labelled
select-all sits inline in the bar.

The bar is the header for every state of the list: it names the mailbox with
nothing ticked and carries the count and the verbs from the first ticked row.
Delete and Mark read act on the rows — trashed rows leave the list, marked
ones lose their unread dot.`,...S.parameters?.docs?.description}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  render: () => <SelectableList isDesktop={false} />,
  decorators: [narrowFrame]
}`,...w.parameters?.docs?.source},description:{story:`The same list at phone width, where selection is a long press and a tap on
the checkbox: no modifier comes off a touch, so there is no range and no
cmd-toggle here. Checkboxes stay put once a row is ticked, and select-all
moves to a second row so row one stays a count and the verbs.`,...w.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: true,
    flatList: true,
    listState: "empty",
    keyboard: noKeyboard
  },
  decorators: [desktopFrame]
}`,...k.parameters?.docs?.source},description:{story:"An empty mailbox, unfiltered: one plain line and no completeness claim.",...k.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: true,
    flatList: true,
    listState: "empty",
    keyboard: noKeyboard,
    listFilter: {
      label: "Personal mail",
      reach: "whole-folder",
      onClear: () => undefined
    },
    listScopeLabel: "Inbox"
  },
  decorators: [desktopFrame]
}`,...v.parameters?.docs?.source},description:{story:`The same pane under a category filter — the composition the inbox ships
(#306). The pane forwards the filter and the scope to the empty state, so a
narrowed list states what was read instead of reading as an empty mailbox.`,...v.parameters?.docs?.description}}};F.parameters={...F.parameters,docs:{...F.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: true,
    flatList: true,
    listState: "error",
    keyboard: noKeyboard,
    errorMessage: "Request timed out while loading this mailbox.",
    onRetry: () => undefined,
    onReportError: () => undefined
  },
  decorators: [desktopFrame]
}`,...F.parameters?.docs?.source},description:{story:`Fail-loud error state — the specific failure detail is surfaced under the
 headline (not a bare "something went wrong"), with a way back (Retry) and a
 place for the failure to go (Report a problem).`,...F.parameters?.docs?.description}}};const Qe=["DesktopList","NarrowTouchList","Brief","InboxWithFilter","InboxWithFilterExpanded","CustomListBody","ConsumerSelection","NarrowConsumerSelection","EmptyState","FilteredEmptyState","ErrorState"];export{N as Brief,S as ConsumerSelection,y as CustomListBody,I as DesktopList,k as EmptyState,F as ErrorState,v as FilteredEmptyState,b as InboxWithFilter,g as InboxWithFilterExpanded,w as NarrowConsumerSelection,C as NarrowTouchList,Qe as __namedExportsOrder,ze as default};
