import{j as e}from"./iframe-uTafckjr.js";import{C as a}from"./calendar-event-chip-H16T2OX4.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./repeat-CUdIp4gT.js";import"./createLucideIcon-DLYy-DY-.js";import"./mail-L6Y6Rsvz.js";const c=["cal-1","cal-2","cal-3","cal-4","cal-5","cal-6"],y={title:"Calendar/Event chip",component:a,parameters:{layout:"padded",docs:{description:{component:`The event as it appears wherever the event's element is ours: an agenda, a
picker, a day column we draw ourselves. Colour says which calendar; shape and
mark say everything else, so an event never depends on hue alone to be read.

Option A's grid is FullCalendar, which renders the element itself and accepts
only a class string and the content inside it, so that one surface restates
this shell rather than mounting the component. The two are held to the same
values — hue, the dashed box for a provisional event, the dimming for a
declined one, the mark size. What the grid cannot take from here is the
element: no \`aria-pressed\`, no focus ring of ours, and a column too short for
the second line this chip puts its marks on.`}}}},t={title:"Q3 roadmap review",timeText:"10:00",color:"cal-1",layout:"row",density:"comfortable",rsvp:"accepted",status:"confirmed",hasThread:!1,isRecurring:!1,zoneCertainty:"local",selected:!1},s={render:()=>e.jsx("div",{className:"flex max-w-sm flex-col gap-1",children:c.map((l,i)=>e.jsx(a,{...t,color:l,title:`Calendar ${i+1}`},l))})},r={render:()=>e.jsxs("div",{className:"flex max-w-sm flex-col gap-1",children:[e.jsx(a,{...t}),e.jsx(a,{...t,title:"Staff screen",status:"tentative"}),e.jsx(a,{...t,title:"Vendor call",rsvp:"declined"}),e.jsx(a,{...t,title:"Standup",isRecurring:!0,hasThread:!1}),e.jsx(a,{...t,title:"Incident review",hasThread:!0}),e.jsx(a,{...t,title:"Offsite dinner",timeText:"19:00",zoneCertainty:"ambiguous"}),e.jsx(a,{...t,title:"Demo",selected:!0})]})},n={render:()=>e.jsxs("div",{className:"flex h-40 gap-1",children:[e.jsx(a,{...t,layout:"column",color:"cal-1"}),e.jsx(a,{...t,layout:"column",color:"cal-3",title:"Design crit",timeText:"10:15"}),e.jsx(a,{...t,layout:"column",color:"cal-4",title:"Vendor call",timeText:"10:45",rsvp:"declined"})]})},o={render:()=>e.jsxs("div",{className:"flex max-w-sm flex-col gap-0.5",children:[e.jsx(a,{...t,density:"compact"}),e.jsx(a,{...t,density:"compact",color:"cal-2",title:"Lunch walk",timeText:"12:30",hasThread:!0}),e.jsx(a,{...t,density:"compact",color:"cal-5",title:"Modular jam",timeText:"20:00"})]})};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex max-w-sm flex-col gap-1">
            {calendarColorIds.map((color, index) => <CalendarEventChip key={color} {...base} color={color} title={\`Calendar \${index + 1}\`} />)}
        </div>
}`,...s.parameters?.docs?.source},description:{story:"The six calendar hues side by side, which is the only test that matters.",...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex max-w-sm flex-col gap-1">
            <CalendarEventChip {...base} />
            <CalendarEventChip {...base} title="Staff screen" status="tentative" />
            <CalendarEventChip {...base} title="Vendor call" rsvp="declined" />
            <CalendarEventChip {...base} title="Standup" isRecurring hasThread={false} />
            <CalendarEventChip {...base} title="Incident review" hasThread />
            <CalendarEventChip {...base} title="Offsite dinner" timeText="19:00" zoneCertainty="ambiguous" />
            <CalendarEventChip {...base} title="Demo" selected />
        </div>
}`,...r.parameters?.docs?.source},description:{story:"Every state the chip carries, in the order it degrades.",...r.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex h-40 gap-1">
            <CalendarEventChip {...base} layout="column" color="cal-1" />
            <CalendarEventChip {...base} layout="column" color="cal-3" title="Design crit" timeText="10:15" />
            <CalendarEventChip {...base} layout="column" color="cal-4" title="Vendor call" timeText="10:45" rsvp="declined" />
        </div>
}`,...n.parameters?.docs?.source},description:{story:"In a time grid the chip fills its slot; the rail keeps the hue readable.",...n.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex max-w-sm flex-col gap-0.5">
            <CalendarEventChip {...base} density="compact" />
            <CalendarEventChip {...base} density="compact" color="cal-2" title="Lunch walk" timeText="12:30" hasThread />
            <CalendarEventChip {...base} density="compact" color="cal-5" title="Modular jam" timeText="20:00" />
        </div>
}`,...o.parameters?.docs?.source},description:{story:"Tighter density drops the chip to the smallest size that still reads.",...o.parameters?.docs?.description}}};const g=["EveryCalendarColour","States","ColumnLayout","Compact"];export{n as ColumnLayout,o as Compact,s as EveryCalendarColour,r as States,g as __namedExportsOrder,y as default};
