import{j as e,r as n}from"./iframe-BxLfZl0d.js";import{E as u}from"./event-editor-FafJ6s0e.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./recurrence-BtiVw_PT.js";import"./button-y3nctzTP.js";import"./input-2W6pRlc_.js";import"./select-CYvsvKoV.js";import"./chevron-down-DBsC1ZFK.js";import"./createLucideIcon-DDkWk8mg.js";import"./chevron-right-C4q9meQG.js";import"./repeat-CKnkGjIf.js";const N={title:"Calendar/Event editor",component:u,parameters:{layout:"padded",docs:{description:{component:`Three fields make an event. Location, guests, notes and repeat are real and
one click away, but they do not charge the common case for their existence.`}}}},x=[{id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"c3",accountId:"a2",accountLabel:"Personal",name:"Personal",color:"cal-2"},{id:"c4",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"}],f={title:"",date:"2026-06-12",startTime:"13:00",endTime:"14:00",allDay:!1,calendarId:"c1",location:"",guests:"",notes:"",repeat:""},h={...f,title:"Release window",startTime:"23:00",endTime:"01:00"};function d({startExpanded:c,seed:i=f}){const[p,l]=n.useState(i),[m,g]=n.useState(c);return e.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface-raised p-4",children:e.jsx(u,{draft:p,onChange:l,calendars:x,expanded:m,onToggleExpanded:()=>g(E=>!E),onSave:()=>{},onCancel:()=>{}})})}const o={render:()=>e.jsx(d,{startExpanded:!1})},a={render:()=>e.jsx(d,{startExpanded:!0})},r={render:()=>e.jsx(d,{startExpanded:!1,seed:h})},t={render:()=>e.jsx(d,{startExpanded:!1,seed:{...h,allDay:!0}})},s={render:()=>{const[c,i]=n.useState(f),[p,l]=n.useState(!1);return e.jsx("div",{className:"max-w-[390px] rounded-lg border border-line bg-surface-raised p-4",children:e.jsx(u,{draft:c,onChange:i,calendars:x,expanded:p,onToggleExpanded:()=>l(m=>!m),onSave:()=>{},onCancel:()=>{},touch:!0})})}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} />
}`,...o.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded />
}`,...a.parameters?.docs?.source},description:{story:"Everything the folded form was hiding.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={backwards} />
}`,...r.parameters?.docs?.source},description:{story:`An end before the start is one date read backwards, not a night that runs
over. The form keeps what was typed, names the problem under the fields and
holds the save until it is fixed.`,...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Live startExpanded={false} seed={{
    ...backwards,
    allDay: true
  }} />
}`,...t.parameters?.docs?.source},description:{story:"All day takes the clock fields away, so there is no range left to reject.",...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [draft, setDraft] = useState(seed);
    const [expanded, setExpanded] = useState(false);
    return <div className="max-w-[390px] rounded-lg border border-line bg-surface-raised p-4">
                <EventEditor draft={draft} onChange={setDraft} calendars={calendars} expanded={expanded} onToggleExpanded={() => setExpanded(open => !open)} onSave={() => {}} onCancel={() => {}} touch />
            </div>;
  }
}`,...s.parameters?.docs?.source},description:{story:"The same form sized for a bottom sheet: every control a thumb target.",...s.parameters?.docs?.description}}};const F=["Folded","Unfolded","EndBeforeStart","AllDay","Touch"];export{t as AllDay,r as EndBeforeStart,o as Folded,s as Touch,a as Unfolded,F as __namedExportsOrder,N as default};
