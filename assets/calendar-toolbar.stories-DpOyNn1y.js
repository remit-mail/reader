import{r as l,j as n}from"./iframe-uufGNBEn.js";import{C as u,a as d}from"./calendar-toolbar-CprmS1TL.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";const{expect:t,userEvent:v,within:w}=__STORYBOOK_MODULE_TEST__,b={title:"Calendar/Toolbar",parameters:{layout:"padded",docs:{description:{component:`The controls that sit above every calendar surface: the zoom ladder and one
way home. The ladder is flat — the step you are on is marked by weight and
hue, the same way the nav marks the mailbox you are in.`}}}},o={render:()=>{const[a,e]=l.useState("week");return n.jsxs("div",{className:"flex flex-col gap-3",children:[n.jsx(d,{value:a,onChange:e}),n.jsx(d,{value:a,onChange:e,views:["day","agenda"],touch:!0}),n.jsxs("p",{className:"text-xs text-fg-muted",children:["Showing: ",a]})]})}},r={render:()=>{const[a,e]=l.useState("week");return n.jsx("div",{className:"rounded-lg border border-line bg-surface p-2",children:n.jsx(u,{title:"8 – 14 June 2026",onPrev:()=>{},onNext:()=>{},onToday:()=>{},children:n.jsx(d,{value:a,onChange:e})})})},play:async({canvasElement:a})=>{const e=w(a);for(const c of["Previous","Next","Today"])await t(e.getByRole("button",{name:c})).toBeVisible();await v.click(e.getByRole("radio",{name:"Day"})),await t(e.getByRole("radio",{name:"Day"})).toBeChecked()}},s={render:()=>{const[a,e]=l.useState("day");return n.jsx("div",{className:"w-[390px] rounded-lg border border-line bg-surface p-2",children:n.jsx(u,{title:"Wed 10 June 2026",onPrev:()=>{},onNext:()=>{},onToday:()=>{},touch:!0,children:n.jsx(d,{value:a,onChange:e,views:["day","agenda"],touch:!0})})})},play:async({canvasElement:a})=>{const e=w(a);for(const c of["Previous","Next","Today"])await t(e.getByRole("button",{name:c})).toBeVisible();await t(e.queryByRole("radio",{name:"Y"})).toBeNull(),await v.click(e.getByRole("radio",{name:"List"})),await t(e.getByRole("radio",{name:"List"})).toBeChecked()}},i={render:()=>n.jsx("div",{className:"w-[420px] rounded-lg border border-line bg-surface p-2",children:n.jsx(u,{title:"29 December 2025 – 4 January 2026, week 1",onPrev:()=>{},onNext:()=>{},onToday:()=>{},children:n.jsx(d,{value:"week",onChange:()=>{}})})}),play:async({canvasElement:a})=>{const e=w(a);await t(e.getByRole("radio",{name:"Week"})).toBeChecked(),await t(e.getByRole("button",{name:"Today"})).toBeVisible()}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [view, setView] = useState<CalendarViewId>("week");
    return <div className="flex flex-col gap-3">
                <CalendarViewSwitch value={view} onChange={setView} />
                <CalendarViewSwitch value={view} onChange={setView} views={["day", "agenda"]} touch />
                <p className="text-xs text-fg-muted">Showing: {view}</p>
            </div>;
  }
}`,...o.parameters?.docs?.source},description:{story:"Year to day is one strip at four magnifications, not four screens.",...o.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [view, setView] = useState<CalendarViewId>("week");
    return <div className="rounded-lg border border-line bg-surface p-2">
                <CalendarDateNav title="8 – 14 June 2026" onPrev={() => {}} onNext={() => {}} onToday={() => {}}>
                    <CalendarViewSwitch value={view} onChange={setView} />
                </CalendarDateNav>
            </div>;
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    for (const name of ["Previous", "Next", "Today"]) {
      await expect(canvas.getByRole("button", {
        name
      })).toBeVisible();
    }
    await userEvent.click(canvas.getByRole("radio", {
      name: "Day"
    }));
    await expect(canvas.getByRole("radio", {
      name: "Day"
    })).toBeChecked();
  }
}`,...r.parameters?.docs?.source},description:{story:"Today lands on the same target from every view and every distance.",...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [view, setView] = useState<CalendarViewId>("day");
    return <div className="w-[390px] rounded-lg border border-line bg-surface p-2">
                <CalendarDateNav title="Wed 10 June 2026" onPrev={() => {}} onNext={() => {}} onToday={() => {}} touch>
                    <CalendarViewSwitch value={view} onChange={setView} views={["day", "agenda"]} touch />
                </CalendarDateNav>
            </div>;
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    for (const name of ["Previous", "Next", "Today"]) {
      await expect(canvas.getByRole("button", {
        name
      })).toBeVisible();
    }
    await expect(canvas.queryByRole("radio", {
      name: "Y"
    })).toBeNull();
    await userEvent.click(canvas.getByRole("radio", {
      name: "List"
    }));
    await expect(canvas.getByRole("radio", {
      name: "List"
    })).toBeChecked();
  }
}`,...s.parameters?.docs?.source},description:{story:`The bar at a phone's width, where the whole ladder does not fit and a year
grid would be unreadable anyway. Back, forward and Today stay: they are how
the calendar is moved, and a toolbar that dropped them to make room would
leave the reader stuck on whatever week they opened on.`,...s.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <div className="w-[420px] rounded-lg border border-line bg-surface p-2">
            <CalendarDateNav title="29 December 2025 – 4 January 2026, week 1" onPrev={() => {}} onNext={() => {}} onToday={() => {}}>
                <CalendarViewSwitch value="week" onChange={() => {}} />
            </CalendarDateNav>
        </div>,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", {
      name: "Week"
    })).toBeChecked();
    await expect(canvas.getByRole("button", {
      name: "Today"
    })).toBeVisible();
  }
}`,...i.parameters?.docs?.source},description:{story:`A range whose name is longer than the room it has. The title gives way, not
the controls: it is the one thing on the bar that can be read off the grid
underneath it.`,...i.parameters?.docs?.description}}};const B=["ViewLadder","DateNav","OnAPhone","LongRangeTitle"];export{r as DateNav,i as LongRangeTitle,s as OnAPhone,o as ViewLadder,B as __namedExportsOrder,b as default};
