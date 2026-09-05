import{r as E,j as y}from"./iframe-uufGNBEn.js";import{d as k,b as D}from"./agenda-time-DsDLGX47.js";import{A as v}from"./agenda-flow-sHw5uv1u.js";import"./preload-helper-PPVm8Dsz.js";import"./apiHelpers-DnyaISng.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./calendar-event-chip-0RvRJ_3A.js";import"./calendar-event-chip-content-B1wiJu2l.js";import"./repeat-BnlNct4V.js";import"./createLucideIcon-Bn-Stmx4.js";import"./mail-DXm5QBOT.js";import"./globe-axgt3PNC.js";import"./calendar-off-Dj9jCCVj.js";import"./chevron-right-B0dowht5.js";import"./map-pin-DUH0Cs8a.js";const J={title:"Calendar/Agenda flow",component:v,parameters:{layout:"fullscreen",docs:{description:{component:`The strip spends its pixels on what is on the day rather than on the hours
the day contains. Every story here is a day the argument has to survive: a
pile-up, a day with nothing but a banner, and a week nobody booked.`}}},decorators:[r=>y.jsx("div",{className:"flex h-[38rem] flex-col border border-line bg-surface",children:y.jsx(r,{})})]},a="2026-06-10",w="+02:00",L=[{id:"work",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"oncall",accountId:"a1",accountLabel:"Work",name:"On-call",color:"cal-4"},{id:"personal",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"}];function e(r,h,b,g,f,S,x={}){return{id:r,calendarId:b,title:h,start:`${g}T${f}:00${w}`,end:`${g}T${S}:00${w}`,allDay:!1,location:"",notes:"",attendees:[],myRsvp:"accepted",threadId:"",threadSubject:"",timeZone:"Europe/Amsterdam",zoneCertainty:"explicit",recurrenceRule:"",seriesId:"",seriesException:!1,status:"confirmed",...x}}const _=[e("evt_standup","Standup","work",a,"09:00","09:15",{recurrenceRule:"Every weekday"}),e("evt_roadmap","Q3 roadmap review","work",a,"10:00","11:30",{location:"Kaap",threadId:"thr_roadmap",attendees:[{name:"Anna Vos",email:"anna@example.test",rsvp:"accepted",role:"organizer"},{name:"Bram Peters",email:"bram@example.test",rsvp:"noReply",role:"attendee"}]}),e("evt_incident","Incident review","oncall",a,"10:30","12:00"),e("evt_1to1","1:1 with Anna","work",a,"11:00","11:20"),e("evt_lunch","Lunch with Jane","personal",a,"12:30","13:30",{location:"Toscanini"}),e("evt_retro","Retro","work",a,"16:00","17:00",{status:"tentative"}),e("evt_dentist","Dentist","personal","2026-06-11","14:00","14:45",{myRsvp:"declined"}),e("evt_call","Lisbon call","work","2026-06-11","17:00","18:00",{zoneCertainty:"ambiguous",timeZone:""}),{...e("evt_devcon","Devcon","work","2026-06-12","00:00","00:00"),start:"2026-06-12",end:"2026-06-13",allDay:!0},e("evt_offsite","Offsite","work","2026-06-22","09:00","17:00")],I=k("2026-06-08","2026-06-24").map(r=>D(r,_,a)),t={days:I,calendars:L,today:a,focusDate:a,selectedEventId:"",onSelectEvent:()=>{},onPickSlot:()=>{},onZoomDay:()=>{},onReachStart:()=>{},onReachEnd:()=>{},onVisibleDayChange:()=>{}},s={args:{...t,density:"pills"}},o={args:{...t,density:"detail"}},n={args:{...t,density:"dots"}},i={args:{...t,density:"pills",focusDate:"2026-06-13"}},c={args:{...t,density:"pills",focusDate:"2026-06-18"}},d={args:{...t,density:"pills",atStartCap:!0,atEndCap:!0,onLoadEarlier:()=>{},onLoadLater:()=>{}}},p={args:{...t,density:"detail",selectedEventId:"evt_roadmap"}},l={args:{...t,density:"pills",touch:!0}},m={args:{...t,density:"pills",todayLead:y.jsx("p",{className:"border-b border-line bg-surface-sunken px-row-inset py-2 text-xs text-fg-muted",children:"Next up · Q3 roadmap review in 30m"})}},u={render:()=>{const[r,h]=E.useState("");return y.jsx(v,{...t,density:"detail",selectedEventId:r,onSelectEvent:h})}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "pills"
  }
}`,...s.parameters?.docs?.source},description:{story:"The default reading: one row an event, free time drawn between them.",...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "detail"
  }
}`,...o.parameters?.docs?.source},description:{story:"Where, who and which calendar, for a day you are actually working through.",...o.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "dots"
  }
}`,...n.parameters?.docs?.source},description:{story:"A month at a glance: colour, load and one word a day.",...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "pills",
    focusDate: "2026-06-13"
  }
}`,...i.parameters?.docs?.source},description:{story:"A day with nothing on the clock says so instead of showing whitespace.",...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "pills",
    focusDate: "2026-06-18"
  }
}`,...c.parameters?.docs?.source},description:{story:"Nine days nobody booked, as one sentence rather than nine screens.",...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "pills",
    atStartCap: true,
    atEndCap: true,
    onLoadEarlier: () => {},
    onLoadLater: () => {}
  }
}`,...d.parameters?.docs?.source},description:{story:`A year either way is as far as the strip grows on the scroll. Past that the
reader says so, rather than the strip fetching its way across a decade
because a sparse diary never fills the pane.`,...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "detail",
    selectedEventId: "evt_roadmap"
  }
}`,...p.parameters?.docs?.source},description:{story:"The selection is a state of the row, not a colour laid over it.",...p.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "pills",
    touch: true
  }
}`,...l.parameters?.docs?.source},description:{story:"Every hit target grows where a finger has to find it.",...l.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    density: "pills",
    todayLead: <p className="border-b border-line bg-surface-sunken px-row-inset py-2 text-xs text-fg-muted">
                Next up · Q3 roadmap review in 30m
            </p>
  }
}`,...m.parameters?.docs?.source},description:{story:"What is next, landed on with today and scrolled away with it.",...m.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [selected, setSelected] = useState("");
    return <AgendaFlow {...base} density="detail" selectedEventId={selected} onSelectEvent={setSelected} />;
  }
}`,...u.parameters?.docs?.source},description:{story:"Selecting a row is the only thing the strip owns; the owner holds the rest.",...u.parameters?.docs?.description}}};const K=["Rows","Detail","Dots","ClearDay","EmptyRun","AtTheCap","Selected","Touch","WithTodayLead","Interactive"];export{d as AtTheCap,i as ClearDay,o as Detail,n as Dots,c as EmptyRun,u as Interactive,s as Rows,p as Selected,l as Touch,m as WithTodayLead,K as __namedExportsOrder,J as default};
