import{j as e,r as f}from"./iframe-DS5xN_9u.js";import{C as g}from"./calendar-slot-offers-DYNqCzBx.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";const k={title:"Design System/Calendar/Slot offers",component:g,parameters:{layout:"padded",docs:{description:{component:`The day's free gaps as things to hand back, not as a grid to read off.
Picking one is not a booking: it goes into a reply as plain text.`}}}},m="2026-06-11";function r(n,i){return{date:m,endDate:m,startTime:n,endTime:i,allDay:!1}}const x=[r("10:45","11:15"),r("11:30","12:00"),r("12:00","12:30"),r("15:15","15:45"),r("16:00","16:30")];function p({touch:n,scroll:i}){const[l,u]=f.useState(["11:30"]);return e.jsxs("div",{className:"max-w-sm",children:[e.jsx(g,{slots:x,picked:new Set(l),onToggle:c=>u(d=>d.includes(c.startTime)?d.filter(h=>h!==c.startTime):[...d,c.startTime]),touch:n,scroll:i}),e.jsxs("p",{className:"mt-2 text-2xs text-fg-subtle",children:[l.length," would go into the reply. Nothing is booked."]})]})}const s={render:()=>e.jsx(p,{})},t={render:()=>e.jsx(p,{scroll:!0})},o={render:()=>e.jsx(p,{touch:!0})},a={args:{slots:[],picked:new Set,onToggle:()=>{}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
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
