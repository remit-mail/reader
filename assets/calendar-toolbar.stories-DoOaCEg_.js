import{r as o,j as e}from"./iframe-BxLfZl0d.js";import{C as i,a as s}from"./calendar-toolbar-DivBxbq_.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./createLucideIcon-DDkWk8mg.js";import"./chevron-right-C4q9meQG.js";const p={title:"Calendar/Toolbar",parameters:{layout:"padded",docs:{description:{component:`The controls that sit above every calendar surface: the zoom ladder and one
way home. The ladder is flat — the step you are on is marked by weight and
hue, the same way the nav marks the mailbox you are in.`}}}},r={render:()=>{const[a,n]=o.useState("week");return e.jsxs("div",{className:"flex flex-col gap-3",children:[e.jsx(s,{value:a,onChange:n}),e.jsx(s,{value:a,onChange:n,views:["day","agenda"],touch:!0}),e.jsxs("p",{className:"text-xs text-fg-muted",children:["Showing: ",a]})]})}},t={render:()=>{const[a,n]=o.useState("week");return e.jsx("div",{className:"rounded-lg border border-line bg-surface p-2",children:e.jsx(i,{title:"8 – 14 June 2026",onPrev:()=>{},onNext:()=>{},onToday:()=>{},children:e.jsx(s,{value:a,onChange:n})})})}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [view, setView] = useState<CalendarViewId>("week");
    return <div className="flex flex-col gap-3">
                <CalendarViewSwitch value={view} onChange={setView} />
                <CalendarViewSwitch value={view} onChange={setView} views={["day", "agenda"]} touch />
                <p className="text-xs text-fg-muted">Showing: {view}</p>
            </div>;
  }
}`,...r.parameters?.docs?.source},description:{story:"Year to day is one strip at four magnifications, not four screens.",...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [view, setView] = useState<CalendarViewId>("week");
    return <div className="rounded-lg border border-line bg-surface p-2">
                <CalendarDateNav title="8 – 14 June 2026" onPrev={() => {}} onNext={() => {}} onToday={() => {}}>
                    <CalendarViewSwitch value={view} onChange={setView} />
                </CalendarDateNav>
            </div>;
  }
}`,...t.parameters?.docs?.source},description:{story:"Today lands on the same target from every view and every distance.",...t.parameters?.docs?.description}}};const v=["ViewLadder","DateNav"];export{t as DateNav,r as ViewLadder,v as __namedExportsOrder,p as default};
