import{r as i,j as e}from"./iframe-uTafckjr.js";import{C as d,a as o,b as c}from"./calendar-toolbar-D7zGPA6G.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./createLucideIcon-DLYy-DY-.js";import"./chevron-right-BFILk7Cj.js";const y={title:"Calendar/Toolbar",parameters:{layout:"padded",docs:{description:{component:`The controls that sit above every calendar surface: the zoom ladder, the
density the reader picks, and one way home.`}}}},t={render:()=>{const[a,r]=i.useState("week");return e.jsxs("div",{className:"flex flex-col gap-3",children:[e.jsx(o,{value:a,onChange:r}),e.jsx(o,{value:a,onChange:r,views:["day","agenda"],touch:!0}),e.jsxs("p",{className:"text-xs text-fg-muted",children:["Showing: ",a]})]})}},n={render:()=>{const[a,r]=i.useState("comfortable");return e.jsx(c,{value:a,onChange:r})}},s={render:()=>{const[a,r]=i.useState("week");return e.jsx("div",{className:"rounded-lg border border-line bg-surface p-2",children:e.jsx(d,{title:"8 – 14 June 2026",onPrev:()=>{},onNext:()=>{},onToday:()=>{},children:e.jsx(o,{value:a,onChange:r})})})}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [view, setView] = useState<CalendarViewId>("week");
    return <div className="flex flex-col gap-3">
                <CalendarViewSwitch value={view} onChange={setView} />
                <CalendarViewSwitch value={view} onChange={setView} views={["day", "agenda"]} touch />
                <p className="text-xs text-fg-muted">Showing: {view}</p>
            </div>;
  }
}`,...t.parameters?.docs?.source},description:{story:"Year to day is one strip at four magnifications, not four screens.",...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [density, setDensity] = useState<Density>("comfortable");
    return <CalendarDensityControl value={density} onChange={setDensity} />;
  }
}`,...n.parameters?.docs?.source},description:{story:"How much of a day fits is the reader's call on every view.",...n.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [view, setView] = useState<CalendarViewId>("week");
    return <div className="rounded-lg border border-line bg-surface p-2">
                <CalendarDateNav title="8 – 14 June 2026" onPrev={() => {}} onNext={() => {}} onToday={() => {}}>
                    <CalendarViewSwitch value={view} onChange={setView} />
                </CalendarDateNav>
            </div>;
  }
}`,...s.parameters?.docs?.source},description:{story:"Today lands on the same target from every view and every distance.",...s.parameters?.docs?.description}}};const g=["ViewLadder","DensityChoice","DateNav"];export{s as DateNav,n as DensityChoice,t as ViewLadder,g as __namedExportsOrder,y as default};
