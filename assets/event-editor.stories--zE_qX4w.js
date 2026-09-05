import{j as e,r as i}from"./iframe-uufGNBEn.js";import{E as x}from"./event-editor-DHQ0xvYE.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./recurrence-BtiVw_PT.js";import"./button-Wi0n0Lyz.js";import"./input-Cs8KaoXd.js";import"./select-jAwdmlAP.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";import"./repeat-BnlNct4V.js";const G={title:"Calendar/Event editor",component:x,parameters:{layout:"padded",docs:{description:{component:`Three fields make an event. Location, guests, notes and repeat are real and
one click away, but they do not charge the common case for their existence.`}}}},E=[{id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"c3",accountId:"a2",accountLabel:"Personal",name:"Personal",color:"cal-2"},{id:"c4",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"}],f={title:"",date:"2026-06-12",startTime:"13:00",endTime:"14:00",allDay:!1,calendarId:"c1",location:"",guests:"",notes:"",repeat:""},g={...f,title:"Release window",startTime:"23:00",endTime:"01:00"};function r({startExpanded:p,seed:l=f,guestsEditable:m,calendarEditable:u}){const[h,b]=i.useState(l),[v,y]=i.useState(p);return e.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface-raised p-4",children:e.jsx(x,{draft:h,onChange:b,calendars:E,expanded:v,onToggleExpanded:()=>y(w=>!w),guestsEditable:m,calendarEditable:u,onSave:()=>{},onCancel:()=>{}})})}const c={render:()=>e.jsx(r,{startExpanded:!1})},a={render:()=>e.jsx(r,{startExpanded:!0})},t={render:()=>e.jsx(r,{startExpanded:!1,seed:g})},s={render:()=>e.jsx(r,{startExpanded:!0,guestsEditable:!0})},o={render:()=>e.jsx(r,{startExpanded:!0,calendarEditable:!1})},n={render:()=>e.jsx(r,{startExpanded:!1,seed:{...g,allDay:!0}})},d={render:()=>{const[p,l]=i.useState(f),[m,u]=i.useState(!1);return e.jsx("div",{className:"max-w-[390px] rounded-lg border border-line bg-surface-raised p-4",children:e.jsx(x,{draft:p,onChange:l,calendars:E,expanded:m,onToggleExpanded:()=>u(h=>!h),onSave:()=>{},onCancel:()=>{},touch:!0})})}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} />
}`,...c.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded />
}`,...a.parameters?.docs?.source},description:{story:"Everything the folded form was hiding.",...a.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={backwards} />
}`,...t.parameters?.docs?.source},description:{story:`An end before the start is one date read backwards, not a night that runs
over. The form keeps what was typed, names the problem under the fields and
holds the save until it is fixed.`,...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded guestsEditable />
}`,...s.parameters?.docs?.source},description:{story:`Guests are opt-in. A store with nowhere to put them leaves the field out, so
the default form has none: a box that takes names and drops them is worse
than no box, because the reader only finds out later.`,...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded calendarEditable={false} />
}`,...o.parameters?.docs?.source},description:{story:`Editing an event that already exists. The collection a resource lives in is
part of its address, so the calendar is read-only here rather than a picker
that changes nothing.`,...o.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={{
    ...backwards,
    allDay: true
  }} />
}`,...n.parameters?.docs?.source},description:{story:"All day takes the clock fields away, so there is no range left to reject.",...n.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [draft, setDraft] = useState(seed);
    const [expanded, setExpanded] = useState(false);
    return <div className="max-w-[390px] rounded-lg border border-line bg-surface-raised p-4">
                <EventEditor draft={draft} onChange={setDraft} calendars={calendars} expanded={expanded} onToggleExpanded={() => setExpanded(open => !open)} onSave={() => {}} onCancel={() => {}} touch />
            </div>;
  }
}`,...d.parameters?.docs?.source},description:{story:"The same form sized for a bottom sheet: every control a thumb target.",...d.parameters?.docs?.description}}};const B=["Folded","Unfolded","EndBeforeStart","WithGuests","WithoutTheCalendarPicker","AllDay","Touch"];export{n as AllDay,t as EndBeforeStart,c as Folded,d as Touch,a as Unfolded,s as WithGuests,o as WithoutTheCalendarPicker,B as __namedExportsOrder,G as default};
