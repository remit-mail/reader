import{j as e,r as i}from"./iframe-zw88L4Mq.js";import{i as W}from"./filter-presets-DijoMGkm.js";import{u as M}from"./use-list-keyboard-Gqr7ZRuX.js";import{F as O}from"./filter-sheet-oKRRHI_0.js";import{M as P}from"./mail-header-0QmC-K9k.js";import{M as T}from"./message-list-pane-BR2UPPyy.js";import{S as H}from"./selection-top-bar-BzOGab_i.js";import"./preload-helper-PPVm8Dsz.js";import"./brief-sections-C5_algbC.js";import"./roving-focus-5ii5MRPr.js";import"./app-shell-types-LVfosKXZ.js";import"./brief-section-Vk7RjgtA.js";import"./cn-yMAG7bfM.js";import"./chevron-down-D70ORMFZ.js";import"./createLucideIcon-AdIgPHc_.js";import"./message-row-CcCINhiH.js";import"./avatar-CZJ-LrXe.js";import"./badge-Ee126ieB.js";import"./label-chip-DCJIAgrz.js";import"./shield-alert-C0MDecMU.js";import"./star-Dn8uDbft.js";import"./paperclip-CYiOVWYx.js";import"./check-DQN2CS7b.js";import"./row-keyboard-4SpR8O0u.js";import"./button-B3Yk1mOK.js";import"./search-bar-CN6aBhgi.js";import"./search-chip-input-CvCaVhfi.js";import"./search-token-chip-DW0cHP4F.js";import"./x-BLGUIrqQ.js";import"./search-CGcOwy8T.js";import"./menu-JwYXQSbq.js";import"./kbd-Ben7Txy6.js";import"./message-list-state-DhE98Ms8.js";import"./circle-alert-CC5hBMsl.js";import"./loader-circle-C8k5aq3T.js";import"./touch-list-BgdV7flX.js";import"./swipeable-row-pR2QvwUR.js";import"./index-CnSpV_wb.js";import"./index-C2f1Dkc0.js";import"./mail-Gf-XIpyp.js";import"./mail-open-BcTU5L4Y.js";import"./trash-2-Du3oCQXI.js";import"./refresh-cw-Ds-1Dw-T.js";import"./banner-zJdgs6dW.js";import"./checkbox-BIdI4NJ8.js";import"./popover-menu-a1nGKRIB.js";import"./progress-bar-DhBNO0WB.js";import"./arrow-left-B9o3nMag.js";import"./folder-input-seYGeMV2.js";import"./sparkles-C30yTofr.js";const S=[{id:"today",label:"Today",threads:[{id:"t1",accountId:"a1",fromName:"Alex Rivera",fromEmail:"alex@example.com",subject:"Q3 planning notes",snippet:"Here are the notes from today's planning session.",timeLabel:"9:42",category:"personal"},{id:"t2",accountId:"a1",fromName:"Acme Billing",fromEmail:"billing@acme.com",subject:"Your invoice is ready",snippet:"Invoice #1042 is available to view.",timeLabel:"8:15",isRead:!0,category:"transactional"}]},{id:"earlier",label:"Earlier",threads:[{id:"t3",accountId:"a1",fromName:"Weekly Digest",fromEmail:"news@digest.com",subject:"This week in tech",snippet:"The top stories you might have missed.",timeLabel:"Mon",category:"newsletter",messageCount:3}]}],We={title:"Screens/Kit/MessageListPane",component:T,parameters:{layout:"centered"},args:{listTitle:"Inbox",listMeta:"3 conversations",sections:S,onSelectThread:()=>{}}},c=t=>e.jsx("div",{className:"h-screen w-96 overflow-hidden border border-line",children:e.jsx(t,{})}),F=t=>e.jsx("div",{className:"overflow-hidden border border-line",style:{width:390,height:844},children:e.jsx(t,{})}),I={focusedId:void 0,handlers:{},ref:()=>{}};function R({briefFilters:t=!1}){const r=M({isDesktop:!0});return e.jsx(T,{listTitle:"Inbox",listMeta:"3 conversations",sections:S,flatList:!t,briefFilters:t,isDesktop:!0,onSelectThread:()=>{},selection:r.selection,keyboard:r.keyboard})}const v={render:()=>e.jsx(R,{}),decorators:[c]},L={args:{isDesktop:!1,flatList:!0},decorators:[F]},j={render:()=>e.jsx(R,{briefFilters:!0}),decorators:[c]};function B({initialExpanded:t=!1}){const r=W(),[N,C]=i.useState(""),[D,E]=i.useState(!1),[d,a]=i.useState(t),[l,m]=i.useState("all"),[k,s]=i.useState(new Set),o=S.flatMap(n=>n.threads);return e.jsxs("div",{className:"flex h-full flex-col",children:[e.jsx(P,{title:"Inbox",unreadCount:3,isDesktop:!1,onMenuClick:()=>{},searchValue:N,onSearchChange:C,searchOpen:D,onSearchOpenChange:E}),e.jsx("div",{className:"min-h-0 flex-1",children:e.jsx(O,{categories:r.categories,filters:r.filters,sources:r.sources,selectedCategory:l,activeFilters:k,expanded:d,onExpandedChange:a,onSelectCategory:m,onToggleFilter:n=>s(A=>{const w=new Set(A);return w.has(n)?w.delete(n):w.add(n),w}),onClear:()=>{m("all"),s(new Set)},children:e.jsx("ul",{className:"divide-y divide-line",children:o.map(n=>e.jsxs("li",{className:"px-row-inset py-2.5",children:[e.jsx("div",{className:"text-sm font-medium text-fg",children:n.fromName}),e.jsx("div",{className:"truncate text-xs text-fg-muted",children:n.subject})]},n.id))})})})]})}const p={render:()=>e.jsx(B,{}),decorators:[F]},u={render:()=>e.jsx(B,{initialExpanded:!0}),decorators:[F]},h={args:{isDesktop:!0,flatList:!0,keyboard:I,listBody:e.jsx("div",{className:"flex-1 overflow-y-auto divide-y divide-line",children:S.flatMap(t=>t.threads.map(r=>e.jsxs("a",{href:`?selectedMessageId=${r.id}`,className:"flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken",children:[e.jsx("span",{className:"font-medium text-sm",children:r.fromName}),e.jsx("span",{className:"text-sm text-fg-muted truncate",children:r.subject})]},r.id)))})},decorators:[c]};function K({isDesktop:t}){const[r,N]=i.useState(new Set),[C,D]=i.useState(new Set),E=S.map(s=>({...s,threads:s.threads.filter(o=>!r.has(o.id)).map(o=>C.has(o.id)?{...o,isRead:!0}:o)})),d=M({isDesktop:t}),{selection:a}=d.cursor,{orderedIds:l}=d,m=l.length>0&&l.every(s=>a.selectedIds.has(s)),k=s=>{s(a.selectedIds),a.clearSelection()};return e.jsx(T,{listTitle:"Inbox",listMeta:"3 conversations",sections:E,flatList:!0,isDesktop:t,onSelectThread:()=>{},selection:d.selection,keyboard:d.keyboard,selectionBar:e.jsx(H,{title:"Inbox",count:a.selectedCount,onCancel:a.clearSelection,onDelete:()=>k(s=>N(o=>new Set([...o,...s]))),onMarkRead:()=>k(s=>D(o=>new Set([...o,...s]))),selectAll:{checked:m,indeterminate:a.hasSelection&&!m,onChange:()=>a.toggleAll(l)}})})}const f={render:()=>e.jsx(K,{isDesktop:!0}),decorators:[c]},x={render:()=>e.jsx(K,{isDesktop:!1}),decorators:[F]},b={args:{isDesktop:!0,flatList:!0,listState:"empty",keyboard:I},decorators:[c]},g={args:{isDesktop:!0,flatList:!0,listState:"empty",keyboard:I,listFilter:{label:"Personal",reach:"whole-folder",onClear:()=>{}},listScopeLabel:"Inbox"},decorators:[c]},y={args:{isDesktop:!0,flatList:!0,listState:"error",keyboard:I,errorMessage:"Request timed out while loading this mailbox.",onRetry:()=>{},onReportError:()=>{}},decorators:[c]};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  render: () => <LiveList />,
  decorators: [desktopFrame]
}`,...v.parameters?.docs?.source}}};L.parameters={...L.parameters,docs:{...L.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: false,
    flatList: true
  },
  decorators: [narrowFrame]
}`,...L.parameters?.docs?.source}}};j.parameters={...j.parameters,docs:{...j.parameters?.docs,source:{originalSource:`{
  render: () => <LiveList briefFilters />,
  decorators: [desktopFrame]
}`,...j.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <InboxScreen />,
  decorators: [narrowFrame]
}`,...p.parameters?.docs?.source},description:{story:"Inbox filter collapsed: header + the FilterSheet bar over the inbox list.",...p.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => <InboxScreen initialExpanded />,
  decorators: [narrowFrame]
}`,...u.parameters?.docs?.source},description:{story:"Inbox filter expanded: categories + Unread/Flagged/Has attachment.",...u.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: true,
    flatList: true,
    keyboard: noKeyboard,
    listBody: <div className="flex-1 overflow-y-auto divide-y divide-line">
                {sections.flatMap(s => s.threads.map(t => <a key={t.id} href={\`?selectedMessageId=\${t.id}\`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken">
                            <span className="font-medium text-sm">{t.fromName}</span>
                            <span className="text-sm text-fg-muted truncate">
                                {t.subject}
                            </span>
                        </a>))}
            </div>
  },
  decorators: [desktopFrame]
}`,...h.parameters?.docs?.source},description:{story:"Consumer-supplied `listBody` slot — the pane renders the chrome while the\n caller owns the scrollable rows, and the keys over those rows with them.\n This models the web-client's virtualized inbox path.",...h.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  render: () => <SelectableList isDesktop />,
  decorators: [desktopFrame]
}`,...f.parameters?.docs?.source},description:{story:`The pane under a selection its consumer owns — it draws the checkboxes and
holds none of the state. Click a checkbox to tick one row, cmd/ctrl-click a
row to tick it without opening it, shift-click to range from the last row
touched, and select-all covers the rows on screen. From 768px up the labelled
select-all sits inline in the bar.

The bar is the header for every state of the list: it names the mailbox with
nothing ticked and carries the count and the verbs from the first ticked row.
Delete and Mark read act on the rows — trashed rows leave the list, marked
ones lose their unread dot.`,...f.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <SelectableList isDesktop={false} />,
  decorators: [narrowFrame]
}`,...x.parameters?.docs?.source},description:{story:`The same list at phone width, where selection is a long press and a tap on
the checkbox: no modifier comes off a touch, so there is no range and no
cmd-toggle here. Checkboxes stay put once a row is ticked, and select-all
moves to a second row so row one stays a count and the verbs.`,...x.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: true,
    flatList: true,
    listState: "empty",
    keyboard: noKeyboard
  },
  decorators: [desktopFrame]
}`,...b.parameters?.docs?.source},description:{story:"An empty mailbox, unfiltered: one plain line and no completeness claim.",...b.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  args: {
    isDesktop: true,
    flatList: true,
    listState: "empty",
    keyboard: noKeyboard,
    listFilter: {
      label: "Personal",
      reach: "whole-folder",
      onClear: () => undefined
    },
    listScopeLabel: "Inbox"
  },
  decorators: [desktopFrame]
}`,...g.parameters?.docs?.source},description:{story:`The same pane under a category filter — the composition the inbox ships
(#306). The pane forwards the filter and the scope to the empty state, so a
narrowed list states what was read instead of reading as an empty mailbox.`,...g.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
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
}`,...y.parameters?.docs?.source},description:{story:`Fail-loud error state — the specific failure detail is surfaced under the
 headline (not a bare "something went wrong"), with a way back (Retry) and a
 place for the failure to go (Report a problem).`,...y.parameters?.docs?.description}}};const Oe=["DesktopList","NarrowTouchList","Brief","InboxWithFilter","InboxWithFilterExpanded","CustomListBody","ConsumerSelection","NarrowConsumerSelection","EmptyState","FilteredEmptyState","ErrorState"];export{j as Brief,f as ConsumerSelection,h as CustomListBody,v as DesktopList,b as EmptyState,y as ErrorState,g as FilteredEmptyState,p as InboxWithFilter,u as InboxWithFilterExpanded,x as NarrowConsumerSelection,L as NarrowTouchList,Oe as __namedExportsOrder,We as default};
