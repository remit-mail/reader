import{r as T,j as a}from"./iframe-DS5xN_9u.js";import{C}from"./calendar-grid-BK1EX04Y.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-event-chip-content-D5Ogs4O9.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./repeat-Bpd_jiVM.js";import"./createLucideIcon-C2HcSaX7.js";import"./mail-ChB4Neff.js";import"./globe-Bxsz-xx5.js";import"./agenda-time-CtvLk1dO.js";import"./event-phrase-nOW2e_Id.js";import"./index-CZzkLRAv.js";import"./index-IJTHyTL_.js";const R="Europe/Amsterdam",D="2026-06-10",_=`${D}T09:30:00+02:00`,$="cal_work",w="cal_home",l="cal_team",b={[$]:"cal-1",[w]:"cal-4",[l]:"cal-6"},O={id:"",calendarId:$,title:"",start:"",end:"",allDay:!1,location:"",notes:"",attendees:[],myRsvp:"accepted",threadId:"",threadSubject:"",timeZone:R,zoneCertainty:"explicit",recurrenceRule:"",seriesId:"",seriesException:!1,status:"confirmed"},e=(t,p,m,I,E,x={})=>({...O,...x,id:t,title:p,start:`2026-06-${m}T${I}:00+02:00`,end:`2026-06-${m}T${E}:00+02:00`}),A=[e("standup-mon","Standup","08","09:15","09:30",{recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup"}),e("supplier","Supplier call","08","11:00","12:00",{calendarId:l,threadId:"th_supplier",zoneCertainty:"ambiguous"}),e("standup-tue","Standup","09","09:15","09:30",{recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup"}),e("review","Design review","09","14:00","15:30",{calendarId:l}),e("standup-wed","Standup","10","09:15","09:30",{recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup"}),e("roadmap","Roadmap review","10","10:00","11:00"),e("dentist","Dentist","10","10:30","11:30",{calendarId:w}),e("retro","Retro","10","10:45","11:15",{calendarId:l,status:"tentative"}),e("lunch","Lunch with Ada","10","12:30","13:30",{calendarId:w}),e("board","Board prep","11","09:00","10:30"),e("skipped","All-hands","11","16:00","17:00",{myRsvp:"declined"}),e("focus","Focus block","12","09:00","12:00",{calendarId:w}),{...O,id:"offsite",calendarId:l,title:"Offsite",allDay:!0,start:"2026-06-11",end:"2026-06-13"}],J={title:"Design System/Calendar/Grid",component:C,parameters:{layout:"fullscreen"},decorators:[t=>a.jsx("div",{className:"h-screen bg-surface p-4",children:a.jsx(t,{})})],args:{view:"week",date:D,events:A,colorByCalendarId:b,density:"comfortable",selectedEventId:"",timeZone:R,now:_,onSelectEvent:()=>{},onPickSlot:()=>{},onRangeChange:()=>{}}},u={},s={args:{date:D,events:A.filter(t=>t.start.startsWith("2026-06-10"))}},n={args:{events:[e("flight","Flight to Lisbon","09","06:00","07:00"),e("late-call","Call with Sydney","11","23:15","23:45")]}},g={args:{events:A.filter(t=>t.allDay)}},v={args:{view:"day"}},h={args:{view:"month"}},y={args:{view:"year"}},S={args:{view:"agenda"}},o={args:{density:"compact"}},f={args:{selectedEventId:"roadmap"}},k={args:{events:[]}},c={args:{view:"agenda",events:[]}},d={args:{now:"2026-06-12T09:30:00+02:00"}},i={render:t=>{const[p,m]=T.useState(""),[I,E]=T.useState("nothing yet"),[x,N]=T.useState("");return a.jsxs("div",{className:"flex h-full flex-col gap-2",children:[a.jsxs("p",{className:"text-xs text-fg-muted",children:[x," — selected: ",p||"none"," — picked: ",I]}),a.jsx("div",{className:"min-h-0 flex-1",children:a.jsx(C,{...t,selectedEventId:p,onSelectEvent:m,onPickSlot:r=>E(r.allDay?`${r.date}, all day`:`${r.date} ${r.startTime}–${r.endTime}`),onRangeChange:N})})]})}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:"{}",...u.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    date: TODAY,
    events: week.filter(event => event.start.startsWith("2026-06-10"))
  }
}`,...s.parameters?.docs?.source},description:{story:"Three events running into each other on the same morning.",...s.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    events: [at("flight", "Flight to Lisbon", "09", "06:00", "07:00"), at("late-call", "Call with Sydney", "11", "23:15", "23:45")]
  }
}`,...n.parameters?.docs?.source},description:{story:"An early flight and a late call: the day runs midnight to midnight.",...n.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  args: {
    events: week.filter(event => event.allDay)
  }
}`,...g.parameters?.docs?.source}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  args: {
    view: "day"
  }
}`,...v.parameters?.docs?.source}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    view: "month"
  }
}`,...h.parameters?.docs?.source}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  args: {
    view: "year"
  }
}`,...y.parameters?.docs?.source}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  args: {
    view: "agenda"
  }
}`,...S.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    density: "compact"
  }
}`,...o.parameters?.docs?.source},description:{story:"Halved slots, and the time comes off the chips that no longer fit it.",...o.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  args: {
    selectedEventId: "roadmap"
  }
}`,...f.parameters?.docs?.source}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  args: {
    events: []
  }
}`,...k.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    view: "agenda",
    events: []
  }
}`,...c.parameters?.docs?.source},description:{story:"Nothing to list is a sentence, not a blank pane.",...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    now: "2026-06-12T09:30:00+02:00"
  }
}`,...d.parameters?.docs?.source},description:{story:`The clock is a prop, so the marker follows it: the same week, read on the
Friday instead.`,...d.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: args => {
    const [selectedEventId, setSelected] = useState("");
    const [picked, setPicked] = useState("nothing yet");
    const [title, setTitle] = useState("");
    return <div className="flex h-full flex-col gap-2">
                <p className="text-xs text-fg-muted">
                    {title} — selected: {selectedEventId || "none"} — picked: {picked}
                </p>
                <div className="min-h-0 flex-1">
                    <CalendarGrid {...args} selectedEventId={selectedEventId} onSelectEvent={setSelected} onPickSlot={pick => setPicked(pick.allDay ? \`\${pick.date}, all day\` : \`\${pick.date} \${pick.startTime}–\${pick.endTime}\`)} onRangeChange={setTitle} />
                </div>
            </div>;
  }
}`,...i.parameters?.docs?.source},description:{story:"Clicking an event selects it; dragging a range reports the slot picked.",...i.parameters?.docs?.description}}};const Q=["Week","Overlapping","OutsideWorkingHours","AllDayBand","Day","Month","Year","Agenda","Compact","Selected","Empty","AgendaEmpty","AnotherDayIsToday","Interactive"];export{S as Agenda,c as AgendaEmpty,g as AllDayBand,d as AnotherDayIsToday,o as Compact,v as Day,k as Empty,i as Interactive,h as Month,n as OutsideWorkingHours,s as Overlapping,f as Selected,u as Week,y as Year,Q as __namedExportsOrder,J as default};
