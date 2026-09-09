import{j as e}from"./iframe-R-hq3KXP.js";import{B as v}from"./button-DALtMcT0.js";import{c as S}from"./popover-menu-BBGhFUAA.js";import{S as C}from"./search-bar-B3uOtoo8.js";import{S as w}from"./selection-top-bar-CItyr_uf.js";import{S as x}from"./search-BcCJOm9z.js";import{M as A}from"./menu-B9Dole3B.js";import{T as M}from"./tag-BP7ByVh4.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./index-ZxZL_Q-I.js";import"./index-B2LaLmsH.js";import"./overlay-scope-CbgdyXI5.js";import"./keymap-dispatch-DTaqnLKC.js";import"./createLucideIcon-BDKPi14T.js";import"./search-chip-input-wFIhuatD.js";import"./search-token-chip-CJFmRpwR.js";import"./x-Czc64qis.js";import"./banner-BhQiwCh2.js";import"./checkbox-kxQaUiyq.js";import"./check-DRXPT3gO.js";import"./minus-Blgn0-_O.js";import"./progress-bar-CAUN4OcQ.js";import"./arrow-left-CBPcXFhH.js";import"./loader-circle-SNCXCa6F.js";import"./trash-2-DVhxVVfp.js";import"./folder-input-D6ZhsG-O.js";import"./sparkles-B6reTTZT.js";import"./shield-alert-_dTS1qDE.js";import"./mail-open-J4yUO5h6.js";const se={title:"Screens/Kit/SelectionTopBar",component:w,parameters:{layout:"padded"},args:{title:"Inbox",onCancel:()=>{},onMarkRead:()=>{},onJunk:()=>{},onMove:()=>{},onOrganize:()=>{},onDelete:()=>{}},render:k=>e.jsx("div",{className:"w-full rounded-md border border-line",children:e.jsx(w,{...k})})},B=()=>e.jsx(S,{triggerLabel:"Apply label to selected messages",triggerIcon:e.jsx(M,{className:"size-4 text-fg-subtle"}),triggerText:"Apply label",align:"start",nested:!0,touch:!1,triggerClassName:"min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg",items:[{key:"work",label:"Work",onSelect:()=>{}},{key:"receipts",label:"Receipts",onSelect:()=>{}}]}),t={checked:!1,indeterminate:!0,onChange:()=>{}},y={navSlot:e.jsx(v,{variant:"ghost",size:"touch",icon:e.jsx(A,{className:"size-5"}),"aria-label":"Menu",className:"-ml-2 shrink-0"}),titleMeta:e.jsx("span",{className:"shrink-0 text-2xs text-fg-subtle",children:"15,338 unread"}),searchSlot:e.jsx(v,{variant:"ghost",size:"touch",icon:e.jsx(x,{className:"size-5"}),"aria-label":"Search",className:"shrink-0"})},n={args:{...y,count:0,selectAll:{checked:!1,onChange:()=>{}}}},a={args:{...y,count:0,selectAll:{checked:!1,onChange:()=>{}},idleSlot:e.jsx("button",{type:"button",className:"flex min-h-11 w-full items-center px-row-inset text-left text-sm text-accent",children:"Make this a filter"}),searchField:e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"min-w-0 flex-1",children:e.jsx(C,{value:"npm",onChange:()=>{},onClear:()=>{},globalFocusKey:!1,showClearButton:!1})}),e.jsx(v,{variant:"ghost",size:"touch",icon:e.jsx(x,{className:"size-5"}),"aria-label":"Close search",className:"shrink-0"})]})}},s={args:{...y,count:1,selectAll:t}},f={args:{count:3,selectAll:t}},o={args:{count:3,selectAll:t,overflowSlot:e.jsx(B,{})}},r={args:{count:2,onMove:void 0,onOrganize:void 0,selectAll:t}},i={args:{count:2,isBusy:!0,selectAll:t}},b={args:{count:4,selectAll:t,notice:{tone:"warning",text:"Move only works within one account — clear selection or pick messages from a single account"}}},c={args:{count:47,selectAll:{checked:!0,indeterminate:!1,onChange:()=>{}}}},l={args:{count:47,selectAll:{checked:!0,indeterminate:!1,onChange:()=>{}},notice:{tone:"info",text:"",action:{label:'Select all matching "npm"',onClick:()=>{}}}}},d={args:{count:3412,statusLabel:'All 3,412 matching "npm" selected',notice:{tone:"info",text:"",action:{label:"Clear selection",onClick:()=>{}}}}},u={args:{count:0,isCounting:!0,statusLabel:"Counting matches…",selectAll:{checked:!0,indeterminate:!1,onChange:()=>{}},notice:{tone:"info",text:"",action:{label:"Stop",onClick:()=>{}}}}},h={args:{count:3412,statusLabel:"Deleting 1,200 of 3,412…",isBusy:!0,progress:{value:1200,max:3412},notice:{tone:"info",text:"",action:{label:"Stop",onClick:()=>{}}}}},m={args:{count:3412,statusLabel:"Deleting 2,100 of 3,412…",isBusy:!0,progress:{value:2100,max:3412},selectAll:{checked:!1,indeterminate:!1,onChange:()=>{}},notice:{tone:"info",text:"",action:{label:"Stop",onClick:()=>{}}}}},p={args:{count:3412,statusLabel:"Moving 1,200 of 3,412…",isBusy:!0,progress:{value:1200,max:3412,tone:"info"}}},g={args:{count:3412,statusLabel:"Marking 1,200 of 3,412 as read…",isBusy:!0,progress:{value:1200,max:3412,tone:"info"}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
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
row of verbs with a back arrow out of selection.`,...s.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3,
    selectAll
  }
}`,...f.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3,
    selectAll,
    overflowSlot: <LabelSlot />
  }
}`,...o.parameters?.docs?.source},description:{story:`The overflow menu with the account's label picker at its foot. Labels carry
no verb on the bar (#477), so this is where applying one lives.`,...o.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    count: 2,
    onMove: undefined,
    onOrganize: undefined,
    selectAll
  }
}`,...r.parameters?.docs?.source},description:{story:`A selection spanning folders or accounts has no move target and no
 account to file a rule under: the bar carries Delete and the overflow.`,...r.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    count: 2,
    isBusy: true,
    selectAll
  }
}`,...i.parameters?.docs?.source},description:{story:`A mutation in flight: Delete carries the spinner and every other verb
 stands down, because nothing else can act until it lands.`,...i.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  args: {
    count: 4,
    selectAll,
    notice: {
      tone: "warning",
      text: "Move only works within one account — clear selection or pick messages from a single account"
    }
  }
}`,...b.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
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
}`,...h.parameters?.docs?.source},description:{story:"A bulk delete in progress reports a running total via `statusLabel` and a\ndeterminate `ProgressBar`; the delete button shows its busy spinner (never\ndisables) and the overflow verbs drop out — nothing here can act mid-delete.\nStop rides on the notice, the way it does while counting: the run outlives\nthe wizard's run screen, so the bar has to be able to end it too.",...h.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    count: 3412,
    statusLabel: "Deleting 2,100 of 3,412…",
    isBusy: true,
    progress: {
      value: 2100,
      max: 3412
    },
    selectAll: {
      checked: false,
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
}`,...m.parameters?.docs?.source},description:{story:`The same run, as the user finds it after leaving the mailbox and coming back.
The selection did not survive the route and nothing is ticked, so the count
and the label are the run's own: an idle header over mail that is still being
deleted would be the lie this replaces. Stop is the same press it was before
they left.`,...m.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
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
}`,...p.parameters?.docs?.source},description:{story:`A move over an escalated selection: same chunked run as a delete, worded for
the action that is running and toned as ordinary progress rather than
destructive.`,...p.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
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
}`,...g.parameters?.docs?.source},description:{story:"Mark-read over the same escalated selection.",...g.parameters?.docs?.description}}};const oe=["Idle","IdleSearching","One","Many","WithLabelPicker","WithoutMoveOrOrganize","Busy","CrossAccountHint","AllSelected","EscalationAvailable","Escalated","Counting","DeletingWithProgress","RunResumedAfterLeaving","MovingWithProgress","MarkingReadWithProgress"];export{c as AllSelected,i as Busy,u as Counting,b as CrossAccountHint,h as DeletingWithProgress,d as Escalated,l as EscalationAvailable,n as Idle,a as IdleSearching,f as Many,g as MarkingReadWithProgress,p as MovingWithProgress,s as One,m as RunResumedAfterLeaving,o as WithLabelPicker,r as WithoutMoveOrOrganize,oe as __namedExportsOrder,se as default};
