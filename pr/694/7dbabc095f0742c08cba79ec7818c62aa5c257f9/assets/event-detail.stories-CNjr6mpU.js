import{j as r}from"./iframe-uTafckjr.js";import{E as a}from"./event-detail-NXdd69nL.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./attendee-row-BKYArOBJ.js";import"./avatar-DtwcLlyW.js";import"./minus-Bt1V8959.js";import"./createLucideIcon-DLYy-DY-.js";import"./x-DS_pud-s.js";import"./clock-DBNchxVL.js";import"./check-CM0cWxPP.js";import"./button-DCXIHjmE.js";import"./pencil-BosOmS7X.js";import"./trash-2-CHrpvC8V.js";import"./repeat-CUdIp4gT.js";import"./mail-L6Y6Rsvz.js";const S={title:"Calendar/Event detail",component:a,parameters:{layout:"fullscreen",docs:{description:{component:`An event opened. The thread it came out of is part of the event rather than a
footnote, so nothing that started as mail is ever a dead end.`}}},decorators:[d=>r.jsx("div",{className:"h-[560px] max-w-lg border border-line",children:r.jsx(d,{})})]},o={id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},s={id:"e1",calendarId:"c1",title:"Q3 roadmap review",start:"2026-06-10T10:00:00+02:00",end:"2026-06-10T11:30:00+02:00",allDay:!1,location:"Room Zuid",notes:"Pre-read is in the thread. Bring the staffing numbers.",attendees:[{name:"Priya Natarajan",email:"priya@northwind.example",rsvp:"accepted",role:"organizer"},{name:"Marcus Webb",email:"marcus@northwind.example",rsvp:"accepted",role:"attendee"},{name:"Dana Okafor",email:"dana@northwind.example",rsvp:"tentative",role:"attendee"},{name:"Sven Larsen",email:"sven@northwind.example",rsvp:"declined",role:"attendee"}],myRsvp:"accepted",threadId:"thr_q3",threadSubject:"Q3 roadmap review — agenda + pre-read",timeZone:"Europe/Amsterdam",zoneCertainty:"local",recurrenceRule:"",seriesId:"",status:"confirmed"},e={render:()=>r.jsx(a,{event:s,calendar:o,whenText:"Wednesday 10 June · 10:00 – 11:30",onEdit:()=>{},onDelete:()=>{},onOpenThread:()=>{}})},n={render:()=>r.jsx(a,{event:{...s,title:"Standup",start:"2026-06-10T09:15:00+02:00",end:"2026-06-10T09:30:00+02:00",location:"Huddle room",notes:"",threadId:"",threadSubject:"",recurrenceRule:"Every weekday at 09:15",seriesId:"ser_standup"},calendar:o,whenText:"Wednesday 10 June · 09:15 – 09:30",onEdit:()=>{},onDelete:()=>{}})},t={render:()=>r.jsx(a,{event:{...s,title:"Offsite dinner",start:"2026-06-11T19:00:00+02:00",end:"2026-06-11T22:00:00+02:00",location:"Toscanini",notes:'The thread says "dinner at 7" and never says where anyone is.',timeZone:"",zoneCertainty:"ambiguous",threadId:"thr_dana",threadSubject:"Offsite logistics — rooms, travel, the dinner"},calendar:o,whenText:"Thursday 11 June · 19:00 – 22:00",onEdit:()=>{},onDelete:()=>{},onOpenThread:()=>{}})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  render: () => <EventDetail event={base} calendar={calendar} whenText="Wednesday 10 June · 10:00 – 11:30" onEdit={() => {}} onDelete={() => {}} onOpenThread={() => {}} />
}`,...e.parameters?.docs?.source},description:{story:"Born from a thread, and one click from it.",...e.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <EventDetail event={{
    ...base,
    title: "Standup",
    start: "2026-06-10T09:15:00+02:00",
    end: "2026-06-10T09:30:00+02:00",
    location: "Huddle room",
    notes: "",
    threadId: "",
    threadSubject: "",
    recurrenceRule: "Every weekday at 09:15",
    seriesId: "ser_standup"
  }} calendar={calendar} whenText="Wednesday 10 June · 09:15 – 09:30" onEdit={() => {}} onDelete={() => {}} />
}`,...n.parameters?.docs?.source},description:{story:"A repeating instance names its rule instead of hiding it in a settings pane.",...n.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <EventDetail event={{
    ...base,
    title: "Offsite dinner",
    start: "2026-06-11T19:00:00+02:00",
    end: "2026-06-11T22:00:00+02:00",
    location: "Toscanini",
    notes: 'The thread says "dinner at 7" and never says where anyone is.',
    timeZone: "",
    zoneCertainty: "ambiguous",
    threadId: "thr_dana",
    threadSubject: "Offsite logistics — rooms, travel, the dinner"
  }} calendar={calendar} whenText="Thursday 11 June · 19:00 – 22:00" onEdit={() => {}} onDelete={() => {}} onOpenThread={() => {}} />
}`,...t.parameters?.docs?.source},description:{story:`A zone we cannot determine is shown as unknown. Guessing quietly is how
someone ends up on the wrong side of a two-hour gap.`,...t.parameters?.docs?.description}}};const I=["FromMail","Recurring","AmbiguousZone"];export{t as AmbiguousZone,e as FromMail,n as Recurring,I as __namedExportsOrder,S as default};
