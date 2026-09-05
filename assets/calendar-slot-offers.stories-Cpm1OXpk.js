import{j as e,r as h}from"./iframe-uufGNBEn.js";import{C as m}from"./calendar-slot-offers-CJbGrqsR.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";const k={title:"Calendar/Slot offers",component:m,parameters:{layout:"padded",docs:{description:{component:`The day's free gaps as things to hand back, not as a grid to read off.
Picking one is not a booking: it goes into a reply as plain text.`}}}},f="2026-06-11";function r(n,i){return{date:f,startTime:n,endTime:i,allDay:!1}}const x=[r("10:45","11:15"),r("11:30","12:00"),r("12:00","12:30"),r("15:15","15:45"),r("16:00","16:30")];function p({touch:n,scroll:i}){const[l,g]=h.useState(["11:30"]);return e.jsxs("div",{className:"max-w-sm",children:[e.jsx(m,{slots:x,picked:new Set(l),onToggle:c=>g(d=>d.includes(c.startTime)?d.filter(u=>u!==c.startTime):[...d,c.startTime]),touch:n,scroll:i}),e.jsxs("p",{className:"mt-2 text-2xs text-fg-subtle",children:[l.length," would go into the reply. Nothing is booked."]})]})}const s={render:()=>e.jsx(p,{})},t={render:()=>e.jsx(p,{scroll:!0})},o={render:()=>e.jsx(p,{touch:!0})},a={args:{slots:[],picked:new Set,onToggle:()=>{}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <Offering />
}`,...s.parameters?.docs?.source},description:{story:"The wrapping block, which is what a mouse gets.",...s.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Offering scroll />
}`,...t.parameters?.docs?.source},description:{story:"A scrolling rail instead, for a panel too narrow to wrap into.",...t.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Offering touch />
}`,...o.parameters?.docs?.source},description:{story:"Thumb-sized targets, which is the only difference touch makes.",...o.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    slots: [],
    picked: new Set<string>(),
    onToggle: () => undefined
  }
}`,...a.parameters?.docs?.source},description:{story:"A day with no gap at this length says so rather than drawing an empty row.",...a.parameters?.docs?.description}}};const j=["Wrapping","Scrolling","Touch","NothingFree"];export{a as NothingFree,t as Scrolling,o as Touch,s as Wrapping,j as __namedExportsOrder,k as default};
