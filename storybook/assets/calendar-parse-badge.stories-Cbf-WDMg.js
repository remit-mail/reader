import{j as r}from"./iframe-DS5xN_9u.js";import{C as o,c as d}from"./calendar-parse-badge-DFlsbsTM.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./createLucideIcon-C2HcSaX7.js";import"./file-text-C_3KKf4b.js";const g={title:"Design System/Calendar/Parse badge",component:o,parameters:{layout:"padded",docs:{description:{component:`Which rung of the ladder answered. The difference between a field the sender
stated and a reading of their prose decides how hard the reader has to check,
so the badge says which one it was.`}}}},n=["ics","markup","pattern"],e={render:()=>r.jsx("div",{className:"flex max-w-md flex-col gap-3",children:n.map(t=>r.jsxs("div",{className:"flex flex-col gap-1",children:[r.jsx(o,{method:t,className:"self-start"}),r.jsx("p",{className:"text-xs text-fg-muted",children:d[t]})]},t))})},a={args:{method:"ics"}},s={args:{method:"pattern"}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source},description:{story:"An attached invitation: the sender's own fields, copied.",...a.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    method: "pattern"
  }
}`,...s.parameters?.docs?.source},description:{story:"A reading of the prose, which is the rung that can be wrong.",...s.parameters?.docs?.description}}};const x=["EveryRung","AttachedInvitation","ReadFromTheWords"];export{a as AttachedInvitation,e as EveryRung,s as ReadFromTheWords,x as __namedExportsOrder,g as default};
