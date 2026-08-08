import{j as o}from"./iframe-uTafckjr.js";import{A as d}from"./auto-moved-badge-Cu8zBBkU.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./badge-DAIFEfjj.js";import"./undo-2-BTY7r3H6.js";import"./createLucideIcon-DLYy-DY-.js";const g={title:"Mail/AutoMovedBadge",component:d,parameters:{layout:"centered"}},r={args:{label:"Moved from Junk by Remit",onUndo:()=>alert("Undo")}},a={args:{label:"Moved from Inbox by Remit",onUndo:()=>alert("Undo")}},s={args:{label:"Moved from Junk by Remit"}},t={args:{label:"Moved from Inbox by Remit",onUndo:()=>alert("Undo"),filtersHref:"/settings/filters"}},e={args:{label:"Reported as spam",onUndo:()=>alert("Undo")}},n={render:()=>o.jsxs("div",{className:"flex flex-col items-start gap-3",children:[o.jsx(d,{label:"Moved from Junk by Remit"}),o.jsx(d,{label:"Moved from Junk by Remit",onUndo:()=>{}}),o.jsx(d,{label:"Moved from Inbox by Remit",onUndo:()=>{},filtersHref:"/settings/filters"})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    label: "Moved from Junk by Remit",
    onUndo: () => alert("Undo")
  }
}`,...r.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    label: "Moved from Inbox by Remit",
    onUndo: () => alert("Undo")
  }
}`,...a.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    label: "Moved from Junk by Remit"
  }
}`,...s.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    label: "Moved from Inbox by Remit",
    onUndo: () => alert("Undo"),
    filtersHref: "/settings/filters"
  }
}`,...t.parameters?.docs?.source}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    label: "Reported as spam",
    onUndo: () => alert("Undo")
  }
}`,...e.parameters?.docs?.source},description:{story:`A user-reported spam message (issue #648). Independent of the classifier/
filter-move shapes above: the badge follows the message wherever it now
lives, including a report that never moved the message at all (it was
already in Junk).`,...e.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col items-start gap-3">
            <AutoMovedBadge label="Moved from Junk by Remit" />
            <AutoMovedBadge label="Moved from Junk by Remit" onUndo={() => undefined} />
            <AutoMovedBadge label="Moved from Inbox by Remit" onUndo={() => undefined} filtersHref="/settings/filters" />
        </div>
}`,...n.parameters?.docs?.source}}};const v=["WithUndo","MovedToJunk","WithoutUndoAction","FilterMoveWithManageLink","ReportedAsSpam","SideBySide"];export{t as FilterMoveWithManageLink,a as MovedToJunk,e as ReportedAsSpam,n as SideBySide,r as WithUndo,s as WithoutUndoAction,v as __namedExportsOrder,g as default};
