import{r as x,j as a}from"./iframe-uufGNBEn.js";import{C as A}from"./calendar-grid-CZ-RoDNZ.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-event-chip-content-B1wiJu2l.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./repeat-BnlNct4V.js";import"./createLucideIcon-Bn-Stmx4.js";import"./mail-DXm5QBOT.js";import"./globe-axgt3PNC.js";import"./event-phrase-nOW2e_Id.js";import"./index-kPMH9ZlQ.js";import"./index-8Sr_-kjb.js";import"./apiHelpers-DnyaISng.js";const C="Europe/Amsterdam",T="2026-06-10",O=`${T}T09:30:00+02:00`,R="cal_work",k="cal_home",i="cal_team",_={[R]:"cal-1",[k]:"cal-4",[i]:"cal-6"},$={id:"",calendarId:R,title:"",start:"",end:"",allDay:!1,location:"",notes:"",attendees:[],myRsvp:"accepted",threadId:"",threadSubject:"",timeZone:C,zoneCertainty:"explicit",recurrenceRule:"",seriesId:"",seriesException:!1,status:"confirmed"},e=(t,p,l,w,I,E={})=>({...$,...E,id:t,title:p,start:`2026-06-${l}T${w}:00+02:00`,end:`2026-06-${l}T${I}:00+02:00`}),D=[e("standup-mon","Standup","08","09:15","09:30",{recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup"}),e("supplier","Supplier call","08","11:00","12:00",{calendarId:i,threadId:"th_supplier",zoneCertainty:"ambiguous"}),e("standup-tue","Standup","09","09:15","09:30",{recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup"}),e("review","Design review","09","14:00","15:30",{calendarId:i}),e("standup-wed","Standup","10","09:15","09:30",{recurrenceRule:"Every weekday, 09:15",seriesId:"ser_standup"}),e("roadmap","Roadmap review","10","10:00","11:00"),e("dentist","Dentist","10","10:30","11:30",{calendarId:k}),e("retro","Retro","10","10:45","11:15",{calendarId:i,status:"tentative"}),e("lunch","Lunch with Ada","10","12:30","13:30",{calendarId:k}),e("board","Board prep","11","09:00","10:30"),e("skipped","All-hands","11","16:00","17:00",{myRsvp:"declined"}),e("focus","Focus block","12","09:00","12:00",{calendarId:k}),{...$,id:"offsite",calendarId:i,title:"Offsite",allDay:!0,start:"2026-06-11",end:"2026-06-13"}],q={title:"Calendar/Grid",component:A,parameters:{layout:"fullscreen"},decorators:[t=>a.jsx("div",{className:"h-screen bg-surface p-4",children:a.jsx(t,{})})],args:{view:"week",date:T,events:D,colorByCalendarId:_,density:"comfortable",selectedEventId:"",timeZone:C,now:O,onSelectEvent:()=>{},onPickSlot:()=>{},onRangeChange:()=>{}}},m={},s={args:{date:T,events:D.filter(t=>t.start.startsWith("2026-06-10"))}},u={args:{events:D.filter(t=>t.allDay)}},g={args:{view:"day"}},v={args:{view:"month"}},y={args:{view:"year"}},h={args:{view:"agenda"}},n={args:{density:"compact"}},S={args:{selectedEventId:"roadmap"}},f={args:{events:[]}},o={args:{view:"agenda",events:[]}},c={args:{now:"2026-06-12T09:30:00+02:00"}},d={render:t=>{const[p,l]=x.useState(""),[w,I]=x.useState("nothing yet"),[E,N]=x.useState("");return a.jsxs("div",{className:"flex h-full flex-col gap-2",children:[a.jsxs("p",{className:"text-xs text-fg-muted",children:[E," — selected: ",p||"none"," — picked: ",w]}),a.jsx("div",{className:"min-h-0 flex-1",children:a.jsx(A,{...t,selectedEventId:p,onSelectEvent:l,onPickSlot:r=>I(r.allDay?`${r.date}, all day`:`${r.date} ${r.startTime}–${r.endTime}`),onRangeChange:N})})]})}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:"{}",...m.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    date: TODAY,
    events: week.filter(event => event.start.startsWith("2026-06-10"))
  }
}`,...s.parameters?.docs?.source},description:{story:"Three events running into each other on the same morning.",...s.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    events: week.filter(event => event.allDay)
  }
}`,...u.parameters?.docs?.source}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  args: {
    view: "day"
  }
}`,...g.parameters?.docs?.source}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  args: {
    view: "month"
  }
}`,...v.parameters?.docs?.source}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  args: {
    view: "year"
  }
}`,...y.parameters?.docs?.source}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: {
    view: "agenda"
  }
}`,...h.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    density: "compact"
  }
}`,...n.parameters?.docs?.source},description:{story:"Halved slots, and the time comes off the chips that no longer fit it.",...n.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  args: {
    selectedEventId: "roadmap"
  }
}`,...S.parameters?.docs?.source}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  args: {
    events: []
  }
}`,...f.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    view: "agenda",
    events: []
  }
}`,...o.parameters?.docs?.source},description:{story:"Nothing to list is a sentence, not a blank pane.",...o.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    now: "2026-06-12T09:30:00+02:00"
  }
}`,...c.parameters?.docs?.source},description:{story:`The clock is a prop, so the marker follows it: the same week, read on the
Friday instead.`,...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
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
}`,...d.parameters?.docs?.source},description:{story:"Clicking an event selects it; dragging a range reports the slot picked.",...d.parameters?.docs?.description}}};const J=["Week","Overlapping","AllDayBand","Day","Month","Year","Agenda","Compact","Selected","Empty","AgendaEmpty","AnotherDayIsToday","Interactive"];export{h as Agenda,o as AgendaEmpty,u as AllDayBand,c as AnotherDayIsToday,n as Compact,g as Day,f as Empty,d as Interactive,v as Month,s as Overlapping,S as Selected,m as Week,y as Year,J as __namedExportsOrder,q as default};
