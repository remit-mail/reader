import{j as o,r as m}from"./iframe-uTafckjr.js";import{C as l}from"./calendar-list-B0q6qMqz.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./check-CM0cWxPP.js";import"./createLucideIcon-DLYy-DY-.js";const S={title:"Calendar/Calendar list",component:l,parameters:{layout:"padded",docs:{description:{component:`The legend and the filter are the same control, and it never leaves the
screen. Hiding it in a popover would mean reading a coloured grid with the
key in another room.`}}},decorators:[c=>o.jsx("div",{className:"max-w-60 rounded-lg border border-line bg-surface py-2",children:o.jsx(c,{})})]},r=[{id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"c2",accountId:"a1",accountLabel:"Work",name:"On-call",color:"cal-4"},{id:"c3",accountId:"a2",accountLabel:"Personal",name:"Personal",color:"cal-2"},{id:"c4",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"},{id:"c5",accountId:"a2",accountLabel:"Personal",name:"Travel",color:"cal-6"},{id:"c6",accountId:"a3",accountLabel:"Synthwave Forum",name:"Synth meetups",color:"cal-5"}],a={render:()=>{const[c,u]=m.useState(new Set(r.map(e=>e.id).filter(e=>e!=="c2")));return o.jsx(l,{calendars:r,visible:c,onToggle:e=>u(s=>{const n=new Set(s);return n.delete(e)||n.add(e),n}),onToggleAccount:(e,s)=>u(n=>{const i=new Set(n);for(const d of r)d.accountId===e&&(s?i.add(d.id):i.delete(d.id));return i})})}},t={render:()=>o.jsx(l,{calendars:r,visible:new Set,onToggle:()=>{}})};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source},description:{story:"Ticking a calendar off is a first-class move, so it takes one click.",...a.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <CalendarList calendars={calendars} visible={new Set()} onToggle={() => {}} />
}`,...t.parameters?.docs?.source},description:{story:"Everything off: an unticked calendar keeps its swatch outline, so the key survives.",...t.parameters?.docs?.description}}};const I=["Interactive","AllHidden"];export{t as AllHidden,a as Interactive,I as __namedExportsOrder,S as default};
