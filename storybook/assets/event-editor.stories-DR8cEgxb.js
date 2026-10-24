import{j as e,r as f}from"./iframe-DS5xN_9u.js";import{E as v}from"./event-editor-CDfp2DEy.js";import"./preload-helper-PPVm8Dsz.js";import"./agenda-time-CtvLk1dO.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./recurrence-BtiVw_PT.js";import"./button-D5VdN6KM.js";import"./input-DvN8Enj2.js";import"./select-DYwAHmvI.js";import"./chevron-down-BvCcAV3K.js";import"./createLucideIcon-C2HcSaX7.js";import"./chevron-right-Bty-6bOx.js";import"./repeat-Bpd_jiVM.js";const{expect:h,userEvent:T,within:B}=__STORYBOOK_MODULE_TEST__,q={title:"Design System/Calendar/Event editor",component:v,parameters:{layout:"padded",docs:{description:{component:`Three fields make an event. Location, guests, notes and repeat are real and
one click away, but they do not charge the common case for their existence.`}}}},w=[{id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"c3",accountId:"a2",accountLabel:"Personal",name:"Personal",color:"cal-2"},{id:"c4",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"}],g={title:"",date:"2026-06-12",startTime:"13:00",endDate:"2026-06-12",endTime:"14:00",allDay:!1,calendarId:"c1",location:"",guests:"",notes:"",repeat:""},b={...g,title:"Release window",startTime:"23:00",endTime:"01:00"},S={...b,endDate:"2026-06-13"},A={...g,title:"Offsite",startTime:"",endTime:"",allDay:!0,endDate:"2026-06-14"};function t({startExpanded:s,seed:a=g,guestsEditable:r,calendarEditable:y}){const[E,D]=f.useState(a),[k,L]=f.useState(s);return e.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface-raised p-4",children:e.jsx(v,{draft:E,onChange:D,calendars:w,expanded:k,onToggleExpanded:()=>L(j=>!j),guestsEditable:r,calendarEditable:y,onSave:()=>{},onCancel:()=>{}})})}const x={render:()=>e.jsx(t,{startExpanded:!1})},n={render:()=>e.jsx(t,{startExpanded:!0})},o={render:()=>e.jsx(t,{startExpanded:!1,seed:b})},d={render:()=>e.jsx(t,{startExpanded:!1,seed:S})},c={render:()=>e.jsx(t,{startExpanded:!1,seed:A})},i={render:()=>e.jsx(t,{startExpanded:!0,guestsEditable:!0})},l={render:()=>e.jsx(t,{startExpanded:!0,calendarEditable:!1})},p={render:()=>e.jsx(t,{startExpanded:!1,seed:{...b,allDay:!0}})},m={render:()=>e.jsx(t,{startExpanded:!1,seed:S}),play:async({canvasElement:s})=>{const a=B(s),r=a.getByLabelText("All day");await T.click(r),await h(a.getByLabelText("End date")).toHaveValue("2026-06-12"),await T.click(r),await h(a.getByLabelText("End date")).toHaveValue("2026-06-13"),await h(a.getByLabelText("End time")).toHaveValue("01:00"),await h(a.queryByText(/Ends before it starts/)).not.toBeInTheDocument()}},u={render:()=>{const[s,a]=f.useState(g),[r,y]=f.useState(!1);return e.jsx("div",{className:"max-w-[390px] rounded-lg border border-line bg-surface-raised p-4",children:e.jsx(v,{draft:s,onChange:a,calendars:w,expanded:r,onToggleExpanded:()=>y(E=>!E),onSave:()=>{},onCancel:()=>{},touch:!0})})}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} />
}`,...x.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded />
}`,...n.parameters?.docs?.source},description:{story:"Everything the folded form was hiding.",...n.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={backwards} />
}`,...o.parameters?.docs?.source},description:{story:`An end before the start reads the span backwards. The form keeps what was
typed, names the problem under the fields and holds the save until it is
fixed.`,...o.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={overnight} />
}`,...d.parameters?.docs?.source},description:{story:"A night that runs past midnight ends on the next day, and saves.",...d.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={weekend} />
}`,...c.parameters?.docs?.source},description:{story:"An all-day event reads from its first day to its last.",...c.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded guestsEditable />
}`,...i.parameters?.docs?.source},description:{story:`Guests are opt-in. A store with nowhere to put them leaves the field out, so
the default form has none: a box that takes names and drops them is worse
than no box, because the reader only finds out later.`,...i.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded calendarEditable={false} />
}`,...l.parameters?.docs?.source},description:{story:`Editing an event that already exists. The collection a resource lives in is
part of its address, so the calendar is read-only here rather than a picker
that changes nothing.`,...l.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={{
    ...backwards,
    allDay: true
  }} />
}`,...p.parameters?.docs?.source},description:{story:"All day takes the clock fields away, so there is no range left to reject.",...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={overnight} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const allDay = canvas.getByLabelText("All day");
    await userEvent.click(allDay);
    await expect(canvas.getByLabelText("End date")).toHaveValue("2026-06-12");
    await userEvent.click(allDay);
    await expect(canvas.getByLabelText("End date")).toHaveValue("2026-06-13");
    await expect(canvas.getByLabelText("End time")).toHaveValue("01:00");
    await expect(canvas.queryByText(/Ends before it starts/)).not.toBeInTheDocument();
  }
}`,...m.parameters?.docs?.source},description:{story:`Ticking All day on a night, then unticking it, gives the night back rather
than collapsing the end onto the start day.`,...m.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [draft, setDraft] = useState(seed);
    const [expanded, setExpanded] = useState(false);
    return <div className="max-w-[390px] rounded-lg border border-line bg-surface-raised p-4">
                <EventEditor draft={draft} onChange={setDraft} calendars={calendars} expanded={expanded} onToggleExpanded={() => setExpanded(open => !open)} onSave={() => {}} onCancel={() => {}} touch />
            </div>;
  }
}`,...u.parameters?.docs?.source},description:{story:"The same form sized for a bottom sheet: every control a thumb target.",...u.parameters?.docs?.description}}};const z=["Folded","Unfolded","EndBeforeStart","RunsPastMidnight","AllDaySpan","WithGuests","WithoutTheCalendarPicker","AllDay","AllDayRoundTrip","Touch"];export{p as AllDay,m as AllDayRoundTrip,c as AllDaySpan,o as EndBeforeStart,x as Folded,d as RunsPastMidnight,u as Touch,n as Unfolded,i as WithGuests,l as WithoutTheCalendarPicker,z as __namedExportsOrder,q as default};
