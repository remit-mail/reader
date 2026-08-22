import{j as e}from"./iframe-BxLfZl0d.js";import{E as o}from"./event-detail-C0vJkdru.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./attendee-row-DL_l3O00.js";import"./avatar-B9NbFnlE.js";import"./minus-D96JXrD1.js";import"./createLucideIcon-DDkWk8mg.js";import"./x-BYZsfpI2.js";import"./clock-L-8RlEWY.js";import"./check-DP9bkLrx.js";import"./button-y3nctzTP.js";import"./globe-DO3SfyBP.js";import"./repeat-CKnkGjIf.js";import"./mail-1A9kE0lO.js";import"./pencil-Cr8-EMk7.js";import"./trash-2-DGdeO5MV.js";const I={title:"Calendar/Event detail",component:o,parameters:{layout:"fullscreen",docs:{description:{component:`An event opened. The thread it came out of is part of the event rather than a
footnote, so nothing that started as mail is ever a dead end.`}}},decorators:[i=>e.jsx("div",{className:"h-[560px] max-w-lg border border-line",children:e.jsx(i,{})})]},s={id:"c1",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},d={id:"e1",calendarId:"c1",title:"Q3 roadmap review",start:"2026-06-10T10:00:00+02:00",end:"2026-06-10T11:30:00+02:00",allDay:!1,location:"Room Zuid",notes:"Pre-read is in the thread. Bring the staffing numbers.",attendees:[{name:"Priya Natarajan",email:"priya@northwind.example",rsvp:"accepted",role:"organizer"},{name:"Marcus Webb",email:"marcus@northwind.example",rsvp:"accepted",role:"attendee"},{name:"Dana Okafor",email:"dana@northwind.example",rsvp:"tentative",role:"attendee"},{name:"Sven Larsen",email:"sven@northwind.example",rsvp:"declined",role:"attendee"}],myRsvp:"accepted",threadId:"thr_q3",threadSubject:"Q3 roadmap review — agenda + pre-read",timeZone:"Europe/Amsterdam",zoneCertainty:"local",recurrenceRule:"",seriesId:"",seriesException:!1,status:"confirmed"},t={render:()=>e.jsx(o,{event:d,calendar:s,whenText:"Wednesday 10 June · 10:00 – 11:30",onEdit:()=>{},onDelete:()=>{},onOpenThread:()=>{}})},n={render:()=>e.jsx(o,{event:{...d,title:"Standup",start:"2026-06-10T09:15:00+02:00",end:"2026-06-10T09:30:00+02:00",location:"Huddle room",notes:"",threadId:"",threadSubject:"",recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup"},calendar:s,whenText:"Wednesday 10 June · 09:15 – 09:30",onEdit:()=>{},onDelete:()=>{}})},r={render:()=>e.jsx(o,{event:{...d,title:"Standup",start:"2026-06-11T10:30:00+02:00",end:"2026-06-11T10:45:00+02:00",location:"Meet",notes:"Pushed an hour and a quarter for the offsite travel window.",threadId:"",threadSubject:"",recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup",seriesException:!0},calendar:s,whenText:"Thursday 11 June · 10:30 – 10:45",onEdit:()=>{},onDelete:()=>{}})},a={render:()=>e.jsx(o,{event:{...d,title:"Offsite dinner",start:"2026-06-11T19:00:00+02:00",end:"2026-06-11T22:00:00+02:00",location:"Toscanini",notes:'The thread says "dinner at 7" and never says where anyone is.',timeZone:"",zoneCertainty:"ambiguous",threadId:"thr_dana",threadSubject:"Offsite logistics — rooms, travel, the dinner"},calendar:s,whenText:"Thursday 11 June · 19:00 – 22:00",onEdit:()=>{},onDelete:()=>{},onOpenThread:()=>{}})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <EventDetail event={base} calendar={calendar} whenText="Wednesday 10 June · 10:00 – 11:30" onEdit={() => {}} onDelete={() => {}} onOpenThread={() => {}} />
}`,...t.parameters?.docs?.source},description:{story:"Born from a thread, and one click from it.",...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <EventDetail event={{
    ...base,
    title: "Standup",
    start: "2026-06-10T09:15:00+02:00",
    end: "2026-06-10T09:30:00+02:00",
    location: "Huddle room",
    notes: "",
    threadId: "",
    threadSubject: "",
    recurrenceRule: "Every weekday, 09:15",
    seriesId: "ser_standup"
  }} calendar={calendar} whenText="Wednesday 10 June · 09:15 – 09:30" onEdit={() => {}} onDelete={() => {}} />
}`,...n.parameters?.docs?.source},description:{story:`A repeating instance names its rule in the words a person would say it, not
as an RRULE, and not folded into a settings pane.`,...n.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <EventDetail event={{
    ...base,
    title: "Standup",
    start: "2026-06-11T10:30:00+02:00",
    end: "2026-06-11T10:45:00+02:00",
    location: "Meet",
    notes: "Pushed an hour and a quarter for the offsite travel window.",
    threadId: "",
    threadSubject: "",
    recurrenceRule: "Every weekday, 09:15",
    seriesId: "ser_standup",
    seriesException: true
  }} calendar={calendar} whenText="Thursday 11 June · 10:30 – 10:45" onEdit={() => {}} onDelete={() => {}} />
}`,...r.parameters?.docs?.source},description:{story:`This Thursday was moved and the rest of the week was not. The rule still
reads back, because the series still owns the morning — what changed is that
this instance no longer matches it, and the badge is where that is said.`,...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source},description:{story:`A zone we cannot determine is shown as unknown. Guessing quietly is how
someone ends up on the wrong side of a two-hour gap.`,...a.parameters?.docs?.description}}};const R=["FromMail","Recurring","SeriesException","AmbiguousZone"];export{a as AmbiguousZone,t as FromMail,n as Recurring,r as SeriesException,R as __namedExportsOrder,I as default};
