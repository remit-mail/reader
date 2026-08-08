import{j as e}from"./iframe-fAVmrNjG.js";import{B as b}from"./button-C4vqyepI.js";import{P as k}from"./popover-menu-BHnOHelk.js";import{S}from"./search-bar-BzQj0g0k.js";import{S as y}from"./selection-top-bar-Dl74R-Aj.js";import{S as w}from"./search-BLZaoIk7.js";import{M as C}from"./menu-CMCCbIBo.js";import{T as A}from"./tag-Ls4jfdVJ.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./createLucideIcon-E7hVbHyY.js";import"./search-chip-input-9FcfGUJN.js";import"./search-token-chip-D1dyw_Bk.js";import"./x-CiqSzl9P.js";import"./banner-Bg20ohk7.js";import"./checkbox-B1hS1in5.js";import"./check-D_cIX8lf.js";import"./progress-bar-Cq-L-jGi.js";import"./arrow-left-Ba6nylc8.js";import"./loader-circle-tGqNKIei.js";import"./trash-2-Dodc-R2m.js";import"./folder-input-CNYzPMSE.js";import"./sparkles-DroEPvOz.js";import"./shield-alert-C2HtGUTP.js";import"./mail-open-D5v5ugjM.js";const Z={title:"Screens/Kit/SelectionTopBar",component:y,parameters:{layout:"padded"},args:{title:"Inbox",onCancel:()=>{},onMarkRead:()=>{},onJunk:()=>{},onMove:()=>{},onOrganize:()=>{},onDelete:()=>{}},render:x=>e.jsx("div",{className:"w-full rounded-md border border-line",children:e.jsx(y,{...x})})},M=()=>e.jsx(k,{triggerLabel:"Apply label to selected messages",triggerIcon:e.jsx(A,{className:"size-4 text-fg-subtle"}),triggerText:"Apply label",align:"start",nested:!0,touch:!1,triggerClassName:"min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg",items:[{key:"work",label:"Work",onSelect:()=>{}},{key:"receipts",label:"Receipts",onSelect:()=>{}}]}),t={checked:!1,indeterminate:!0,onChange:()=>{}},v={navSlot:e.jsx(b,{variant:"ghost",size:"touch",icon:e.jsx(C,{className:"size-5"}),"aria-label":"Menu",className:"-ml-2 shrink-0"}),titleMeta:e.jsx("span",{className:"shrink-0 text-2xs text-fg-subtle",children:"15,338 unread"}),searchSlot:e.jsx(b,{variant:"ghost",size:"touch",icon:e.jsx(w,{className:"size-5"}),"aria-label":"Search",className:"shrink-0"})},n={args:{...v,count:0,selectAll:{checked:!1,onChange:()=>{}}}},a={args:{...v,count:0,selectAll:{checked:!1,onChange:()=>{}},idleSlot:e.jsx("button",{type:"button",className:"flex min-h-11 w-full items-center px-row-inset text-left text-sm text-accent",children:"Make this a filter"}),searchField:e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"min-w-0 flex-1",children:e.jsx(S,{value:"npm",onChange:()=>{},onClear:()=>{},globalFocusKey:!1,showClearButton:!1})}),e.jsx(b,{variant:"ghost",size:"touch",icon:e.jsx(w,{className:"size-5"}),"aria-label":"Close search",className:"shrink-0"})]})}},s={args:{...v,count:1,selectAll:t}},g={args:{count:3,selectAll:t}},r={args:{count:3,selectAll:t,overflowSlot:e.jsx(M,{})}},o={args:{count:2,onMove:void 0,onOrganize:void 0,selectAll:t}},i={args:{count:2,isBusy:!0,selectAll:t}},f={args:{count:4,selectAll:t,notice:{tone:"warning",text:"Move only works within one account — clear selection or pick messages from a single account"}}},c={args:{count:47,selectAll:{checked:!0,indeterminate:!1,onChange:()=>{}}}},l={args:{count:47,selectAll:{checked:!0,indeterminate:!1,onChange:()=>{}},notice:{tone:"info",text:"",action:{label:'Select all matching "npm"',onClick:()=>{}}}}},d={args:{count:3412,statusLabel:'All 3,412 matching "npm" selected',notice:{tone:"info",text:"",action:{label:"Clear selection",onClick:()=>{}}}}},u={args:{count:0,isCounting:!0,statusLabel:"Counting matches…",selectAll:{checked:!0,indeterminate:!1,onChange:()=>{}},notice:{tone:"info",text:"",action:{label:"Stop",onClick:()=>{}}}}},h={args:{count:3412,statusLabel:"Deleting 1,200 of 3,412…",isBusy:!0,progress:{value:1200,max:3412}}},m={args:{count:3412,statusLabel:"Moving 1,200 of 3,412…",isBusy:!0,progress:{value:1200,max:3412,tone:"info"}}},p={args:{count:3412,statusLabel:"Marking 1,200 of 3,412 as read…",isBusy:!0,progress:{value:1200,max:3412,tone:"info"}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    ...chrome,
    count: 0,
    selectAll: {
      checked: false,
      onChange: () => undefined
    }
  }
}`,...n.parameters?.docs?.source},description:{story:`Nothing ticked: the surface is the list header and names the mailbox. From
768px up the select-all control is already there — the same bar, one state
earlier, rather than a second surface that appears on the first tick.`,...n.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    ...chrome,
    count: 0,
    selectAll: {
      checked: false,
      onChange: () => undefined
    },
    idleSlot: <button type="button" className="flex min-h-11 w-full items-center px-row-inset text-left text-sm text-accent">
                Make this a filter
            </button>,
    searchField: <>
                <div className="min-w-0 flex-1">
                    <SearchBar value="npm" onChange={() => undefined} onClear={() => undefined} globalFocusKey={false} showClearButton={false} />
                </div>
                <Button variant="ghost" size="touch" icon={<Search className="size-5" />} aria-label="Close search" className="shrink-0" />
            </>
  }
}`,...a.parameters?.docs?.source},description:{story:`The same idle bar with search expanded over the title, which is what the
 tablet header does once a query is in play, and the make-filter row the
 search offers under it.`,...a.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    ...chrome,
    count: 1,
    selectAll
  }
}`,...s.parameters?.docs?.source},description:{story:`One ticked row. The count takes the title's place and the header's own
chrome stands down; the verbs arrive with it: Delete, Move and Organize
carry a glyph, Junk and Mark read live under the kebab. Every one of them
opens the wizard. Below 768px select-all takes a second row, so row one
stays a count and a
row of verbs with a back arrow out of selection.`,...s.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3,
    selectAll
  }
}`,...g.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3,
    selectAll,
    overflowSlot: <LabelSlot />
  }
}`,...r.parameters?.docs?.source},description:{story:`The overflow menu with the account's label picker at its foot. Labels carry
no verb on the bar (#477), so this is where applying one lives.`,...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    count: 2,
    onMove: undefined,
    onOrganize: undefined,
    selectAll
  }
}`,...o.parameters?.docs?.source},description:{story:`A selection spanning folders or accounts has no move target and no
 account to file a rule under: the bar carries Delete and the overflow.`,...o.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    count: 2,
    isBusy: true,
    selectAll
  }
}`,...i.parameters?.docs?.source},description:{story:`A mutation in flight: Delete carries the spinner and every other verb
 stands down, because nothing else can act until it lands.`,...i.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  args: {
    count: 4,
    selectAll,
    notice: {
      tone: "warning",
      text: "Move only works within one account — clear selection or pick messages from a single account"
    }
  }
}`,...f.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    count: 47,
    selectAll: {
      checked: true,
      indeterminate: false,
      onChange: () => undefined
    }
  }
}`,...c.parameters?.docs?.source},description:{story:`Every loaded row checked. The control now says what pressing it does, and
the count line names its scope by default — "All 47 loaded selected" —
instead of a bare "47 messages selected" next to a fully ticked box, which
reads as "everything" to anyone who has used a select-all checkbox before.`,...c.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    count: 47,
    selectAll: {
      checked: true,
      indeterminate: false,
      onChange: () => undefined
    },
    notice: {
      tone: "info",
      text: "",
      action: {
        label: 'Select all matching "npm"',
        onClick: () => undefined
      }
    }
  }
}`,...l.parameters?.docs?.source},description:{story:`The search has more matches than are loaded: an escalation notice offers a
real button (not prose) naming the scope. Tapping it is what flips the
selection's identity from an id set to the search query (\`useEscalatedActions\`
in web-client). No count in the label yet — the real client's own read path
(\`ThreadOperations.searchThreads\`) only counts within a capped recency
window short of paging the whole result set, and paging it just to seed a
button label the user hasn't asked for yet would burn a request on every
render of "all loaded selected" for a number that goes stale the moment new
mail arrives. Tapping the button is what pays for the real count, via the
counting state below.`,...l.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3412,
    statusLabel: 'All 3,412 matching "npm" selected',
    notice: {
      tone: "info",
      text: "",
      action: {
        label: "Clear selection",
        onClick: () => undefined
      }
    }
  }
}`,...d.parameters?.docs?.source},description:{story:`Selection has been escalated to the search query: the count names the
query's total, not a materialized id count, and the notice offers a way
back to the bounded selection.

Every verb the bar carries stays available here (#114), and every one of
them opens the wizard, which names the predicate and states its count before
anything runs (#508). From the bar's side nothing changes, which is the
point: an escalated selection is a selection.`,...d.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    count: 0,
    isCounting: true,
    statusLabel: "Counting matches…",
    selectAll: {
      checked: true,
      indeterminate: false,
      onChange: () => undefined
    },
    notice: {
      tone: "info",
      text: "",
      action: {
        label: "Stop",
        onClick: () => undefined
      }
    }
  }
}`,...u.parameters?.docs?.source},description:{story:`While the server is answering how many messages the search matches, the total
isn't on screen yet — the verbs are hidden (nothing to act on without it) and
Stop drops the escalation.`,...u.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3412,
    statusLabel: "Deleting 1,200 of 3,412…",
    isBusy: true,
    progress: {
      value: 1200,
      max: 3412
    }
  }
}`,...h.parameters?.docs?.source},description:{story:"A bulk delete in progress reports a running total via `statusLabel` and a\ndeterminate `ProgressBar`; the delete button shows its busy spinner (never\ndisables) and the overflow verbs drop out — nothing here can act mid-delete.",...h.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3412,
    statusLabel: "Moving 1,200 of 3,412…",
    isBusy: true,
    progress: {
      value: 1200,
      max: 3412,
      tone: "info"
    }
  }
}`,...m.parameters?.docs?.source},description:{story:`A move over an escalated selection: same chunked run as a delete, worded for
the action that is running and toned as ordinary progress rather than
destructive.`,...m.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3412,
    statusLabel: "Marking 1,200 of 3,412 as read…",
    isBusy: true,
    progress: {
      value: 1200,
      max: 3412,
      tone: "info"
    }
  }
}`,...p.parameters?.docs?.source},description:{story:"Mark-read over the same escalated selection.",...p.parameters?.docs?.description}}};const $=["Idle","IdleSearching","One","Many","WithLabelPicker","WithoutMoveOrOrganize","Busy","CrossAccountHint","AllSelected","EscalationAvailable","Escalated","Counting","DeletingWithProgress","MovingWithProgress","MarkingReadWithProgress"];export{c as AllSelected,i as Busy,u as Counting,f as CrossAccountHint,h as DeletingWithProgress,d as Escalated,l as EscalationAvailable,n as Idle,a as IdleSearching,g as Many,p as MarkingReadWithProgress,m as MovingWithProgress,s as One,r as WithLabelPicker,o as WithoutMoveOrOrganize,$ as __namedExportsOrder,Z as default};
