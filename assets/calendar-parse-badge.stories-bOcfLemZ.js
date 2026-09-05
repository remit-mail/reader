import{j as s}from"./iframe-uufGNBEn.js";import{C as o,c as d}from"./calendar-parse-badge-CoW4c8u0.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./createLucideIcon-Bn-Stmx4.js";import"./file-text-wmSXByn2.js";const g={title:"Calendar/Parse badge",component:o,parameters:{layout:"padded",docs:{description:{component:`Which rung of the ladder answered. The difference between a field the sender
stated and a reading of their prose decides how hard the reader has to check,
so the badge says which one it was.`}}}},n=["ics","markup","pattern"],e={render:()=>s.jsx("div",{className:"flex max-w-md flex-col gap-3",children:n.map(t=>s.jsxs("div",{className:"flex flex-col gap-1",children:[s.jsx(o,{method:t,className:"self-start"}),s.jsx("p",{className:"text-xs text-fg-muted",children:d[t]})]},t))})},a={args:{method:"ics"}},r={args:{method:"pattern"}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex max-w-md flex-col gap-3">
            {methods.map(method => <div key={method} className="flex flex-col gap-1">
                    <CalendarParseBadge method={method} className="self-start" />
                    <p className="text-xs text-fg-muted">{calendarParseNote[method]}</p>
                </div>)}
        </div>
}`,...e.parameters?.docs?.source},description:{story:"The whole ladder at once, each with the note that belongs to it.",...e.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    method: "ics"
  }
}`,...a.parameters?.docs?.source},description:{story:"An attached invitation: the sender's own fields, copied.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    method: "pattern"
  }
}`,...r.parameters?.docs?.source},description:{story:"A reading of the prose, which is the rung that can be wrong.",...r.parameters?.docs?.description}}};const x=["EveryRung","AttachedInvitation","ReadFromTheWords"];export{a as AttachedInvitation,e as EveryRung,r as ReadFromTheWords,x as __namedExportsOrder,g as default};
