import{j as e,r as u}from"./iframe-fAVmrNjG.js";import{A as S}from"./avatar-CaxZOEiX.js";import{R as C}from"./refresh-button-CDBM6OB2.js";import{S as l}from"./shell-top-bar-CPsUND9m.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./button-C4vqyepI.js";import"./circle-alert-CLLSHsxA.js";import"./createLucideIcon-E7hVbHyY.js";import"./circle-check-big-_NcXkTEj.js";import"./refresh-cw-DwfvKgKN.js";import"./app-top-bar-D7D28c-f.js";import"./app-shell-types-DpJ4kEIP.js";import"./dialog-dF5WUjjH.js";import"./menu-CMCCbIBo.js";import"./search-bar-BzQj0g0k.js";import"./search-chip-input-9FcfGUJN.js";import"./search-token-chip-D1dyw_Bk.js";import"./x-CiqSzl9P.js";import"./search-BLZaoIk7.js";import"./bug-83mU2Ndx.js";import"./settings-Cpgtr1TD.js";const D={title:"Mail/ShellTopBar",component:l,parameters:{layout:"fullscreen"}},g={id:"in:spam",label:"in:spam",tone:"scope"},f=()=>e.jsx("button",{type:"button","aria-label":"Account",children:e.jsx(S,{name:"Matthijs van Henten",email:"mvh@example.com",size:"sm"})}),v=({state:d="idle"})=>e.jsx(C,{state:d,label:"Refresh all accounts",errorMessage:d==="error"?"2 of 3 accounts couldn't be reached":void 0,onRefresh:()=>{}}),r=({initialChips:d,scope:x="global",refreshState:b="idle"})=>{const[h,m]=u.useState(d),[y,p]=u.useState("");return e.jsx(l,{search:{value:y,scope:h?.length?x:"global",chips:h,onChange:p,onClear:()=>{p(""),m(void 0)},onClearQuery:()=>p(""),onRemoveChip:()=>m(void 0)},onCompose:()=>{},onReportBug:()=>{},onOpenSettings:()=>{},composeShortcut:"c",refreshControl:e.jsx(v,{state:b}),account:e.jsx(f,{})})},s={render:()=>e.jsx(r,{})},o={render:()=>e.jsx(r,{initialChips:[g],scope:"scoped"})},t={render:()=>e.jsx(l,{search:{value:"",scope:"pending",onChange:()=>{},onClear:()=>{},onClearQuery:()=>{}},onCompose:()=>{},onReportBug:()=>{},onOpenSettings:()=>{},composeShortcut:"c",refreshControl:e.jsx(v,{}),account:e.jsx(f,{})})},a={render:()=>e.jsx(r,{initialChips:[{id:"is:starred",label:"is:starred",tone:"scope"}],scope:"scoped"})},n={render:()=>e.jsx(r,{refreshState:"refreshing"})},i={render:()=>e.jsx(r,{refreshState:"error"})},c={render:()=>e.jsxs("div",{className:"flex h-96 flex-col bg-canvas",children:[e.jsx(r,{initialChips:[g],scope:"scoped"}),e.jsxs("div",{className:"flex min-h-0 flex-1",children:[e.jsx("div",{className:"w-56 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted",children:"Nav — under the bar, like every other pane"}),e.jsx("div",{className:"w-72 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted",children:"Message list"}),e.jsx("div",{className:"min-w-0 flex-1 p-3 text-xs text-fg-muted",children:"Message pane — its own toolbar lives here, under the bar"})]})]})};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <Bar />
}`,...s.parameters?.docs?.source},description:{story:`The daily brief's state: search unscoped, nothing narrowing it, and the only
placeholder allowed to claim it searches all mail — which it genuinely does,
across every folder of every account.`,...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Bar initialChips={[SCOPE]} scope="scoped" />
}`,...o.parameters?.docs?.source},description:{story:`A narrowing scope in the bar, tinted to mark it as the view the user is in
rather than a filter they typed. Removing it widens the search again — a
navigation back to the brief, not an edit of the text, because the chip
mirrors the route. The placeholder narrows with the chip.`,...o.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <ShellTopBar search={{
    value: "",
    scope: "pending",
    onChange: () => undefined,
    onClear: () => undefined,
    onClearQuery: () => undefined
  }} onCompose={() => undefined} onReportBug={() => undefined} onOpenSettings={() => undefined} composeShortcut="c" refreshControl={<GlobalRefresh />} account={<Account />} />
}`,...t.parameters?.docs?.source},description:{story:`A mailbox route whose name has not resolved yet. The list underneath is
already narrowed, so the bar must not claim to search everything — and a chip
reading a raw uuid is worse than no chip, so it shows none and falls back to
neutral wording until the name arrives.`,...t.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Bar initialChips={[{
    id: "is:starred",
    label: "is:starred",
    tone: "scope"
  }]} scope="scoped" />
}`,...a.parameters?.docs?.source},description:{story:"The virtual collections scope the bar too, and their chips read as whatever\ndescribes the collection. Flagged is a marker on the mail rather than a\nplace, so it chips `is:starred`.",...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Bar refreshState="refreshing" />
}`,...n.parameters?.docs?.source},description:{story:`The global refresh mid-flight — every connected account syncing at once,
next to the avatar it sits beside.`,...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Bar refreshState="error" />
}`,...i.parameters?.docs?.source},description:{story:`At least one account couldn't be reached. The tooltip and accessible name
say so; the button stays clickable to retry.`,...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex h-96 flex-col bg-canvas">
            <Bar initialChips={[SCOPE]} scope="scoped" />
            <div className="flex min-h-0 flex-1">
                <div className="w-56 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
                    Nav — under the bar, like every other pane
                </div>
                <div className="w-72 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
                    Message list
                </div>
                <div className="min-w-0 flex-1 p-3 text-xs text-fg-muted">
                    Message pane — its own toolbar lives here, under the bar
                </div>
            </div>
        </div>
}`,...c.parameters?.docs?.source},description:{story:"The arrangement: one bar across the top of the shell, over every pane.",...c.parameters?.docs?.description}}};const I=["Unscoped","Scoped","ScopePending","ScopedToFlagged","RefreshingAllAccounts","RefreshFailed","OverTheLayout"];export{c as OverTheLayout,i as RefreshFailed,n as RefreshingAllAccounts,t as ScopePending,o as Scoped,a as ScopedToFlagged,s as Unscoped,I as __namedExportsOrder,D as default};
