import{j as s,r as p}from"./iframe-BxLfZl0d.js";import{C as d}from"./calendar-list-CppJLEOv.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./chevron-down-DBsC1ZFK.js";import"./createLucideIcon-DDkWk8mg.js";import"./chevron-right-C4q9meQG.js";import"./check-DP9bkLrx.js";const T={title:"Calendar/Calendar list",component:d,parameters:{layout:"padded",docs:{description:{component:`The legend and the filter are the same control, and it never leaves the
screen. Hiding it in a popover would mean reading a coloured grid with the
key in another room.`}}},decorators:[a=>s.jsx("div",{className:"max-w-60 rounded-lg border border-line bg-surface py-2",children:s.jsx(a,{})})]},n=[{id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"c2",accountId:"a1",accountLabel:"Work",name:"On-call",color:"cal-4"},{id:"c3",accountId:"a2",accountLabel:"Personal",name:"Personal",color:"cal-2"},{id:"c4",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"},{id:"c5",accountId:"a2",accountLabel:"Personal",name:"Travel",color:"cal-6"},{id:"c6",accountId:"a3",accountLabel:"Synthwave Forum",name:"Synth meetups",color:"cal-5"}],r={render:()=>{const[a,m]=p.useState(new Set(n.map(e=>e.id).filter(e=>e!=="c2")));return s.jsx(d,{calendars:n,visible:a,onToggle:e=>m(i=>{const t=new Set(i);return t.delete(e)||t.add(e),t}),onToggleAccount:(e,i)=>m(t=>{const l=new Set(t);for(const u of n)u.accountId===e&&(i?l.add(u.id):l.delete(u.id));return l})})}},o={render:()=>s.jsx(d,{calendars:n,visible:new Set(n.map(a=>a.id)),onToggle:()=>{},onToggleAccount:()=>{},closedAccountIds:["a2"]})},c={render:()=>s.jsx(d,{calendars:n,visible:new Set,onToggle:()=>{}})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [visible, setVisible] = useState(new Set(calendars.map(c => c.id).filter(id => id !== "c2")));
    return <CalendarList calendars={calendars} visible={visible} onToggle={id => setVisible(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    })} onToggleAccount={(accountId, nextVisible) => setVisible(prev => {
      const next = new Set(prev);
      for (const calendar of calendars) {
        if (calendar.accountId !== accountId) continue;
        if (nextVisible) next.add(calendar.id);else next.delete(calendar.id);
      }
      return next;
    })} />;
  }
}`,...r.parameters?.docs?.source},description:{story:"Ticking a calendar off is a first-class move, so it takes one click.",...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <CalendarList calendars={calendars} visible={new Set(calendars.map(c => c.id))} onToggle={() => {}} onToggleAccount={() => {}} closedAccountIds={["a2"]} />
}`,...o.parameters?.docs?.source},description:{story:`An account folded shut. Its calendars are still on the grid — the caret hides
rows, the tick hides events, and the two are not the same thing.`,...o.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <CalendarList calendars={calendars} visible={new Set()} onToggle={() => {}} />
}`,...c.parameters?.docs?.source},description:{story:"Everything off: an unticked calendar keeps its swatch outline, so the key survives.",...c.parameters?.docs?.description}}};const y=["Interactive","AccountFolded","AllHidden"];export{o as AccountFolded,c as AllHidden,r as Interactive,y as __namedExportsOrder,T as default};
