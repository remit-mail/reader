import{j as o}from"./iframe-BxLfZl0d.js";import{A as d}from"./auto-moved-badge-eN8-oK4u.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./badge-Bz4-5UiN.js";import"./undo-2-CnFziX6B.js";import"./createLucideIcon-DDkWk8mg.js";const b={title:"Mail/AutoMovedBadge",component:d,parameters:{layout:"centered"}},r={args:{label:"Moved from Junk by Remit",onUndo:()=>alert("Undo")}},a={args:{label:"Moved from Inbox by Remit",onUndo:()=>alert("Undo")}},s={args:{label:"Moved from Junk by Remit"}},n={args:{label:"Moved from Inbox by Remit",onUndo:()=>alert("Undo"),filtersHref:"/settings/filters"}},e={args:{label:"Reported as spam",onUndo:()=>alert("Undo")}},t={render:()=>o.jsxs("div",{className:"flex flex-col items-start gap-3",children:[o.jsx(d,{label:"Moved from Junk by Remit"}),o.jsx(d,{label:"Moved from Junk by Remit",onUndo:()=>{}}),o.jsx(d,{label:"Moved from Inbox by Remit",onUndo:()=>{},filtersHref:"/settings/filters"})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
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
}`,...s.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    label: "Moved from Inbox by Remit",
    onUndo: () => alert("Undo"),
    filtersHref: "/settings/filters"
  }
}`,...n.parameters?.docs?.source}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    label: "Reported as spam",
    onUndo: () => alert("Undo")
  }
}`,...e.parameters?.docs?.source},description:{story:`A user-reported spam message (issue #648). Independent of the classifier/
filter-move shapes above: the badge follows the message wherever it now
lives, including a report that never moved the message at all (it was
already in Junk).`,...e.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col items-start gap-3">
            <AutoMovedBadge label="Moved from Junk by Remit" />
            <AutoMovedBadge label="Moved from Junk by Remit" onUndo={() => undefined} />
            <AutoMovedBadge label="Moved from Inbox by Remit" onUndo={() => undefined} filtersHref="/settings/filters" />
        </div>
}`,...t.parameters?.docs?.source}}};const g=["WithUndo","MovedToJunk","WithoutUndoAction","FilterMoveWithManageLink","ReportedAsSpam","SideBySide"];export{n as FilterMoveWithManageLink,a as MovedToJunk,e as ReportedAsSpam,t as SideBySide,r as WithUndo,s as WithoutUndoAction,g as __namedExportsOrder,b as default};
