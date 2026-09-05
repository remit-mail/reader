import{r as w,j as e}from"./iframe-uufGNBEn.js";import{r as h,f as C,b as T}from"./agenda-time-DsDLGX47.js";import{A as u,N as x,F as U,P as S}from"./agenda-panels-DaT_DID0.js";import"./preload-helper-PPVm8Dsz.js";import"./apiHelpers-DnyaISng.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./calendar-toolbar-CprmS1TL.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";import"./clock-Cx4gZNlA.js";import"./calendar-off-Dj9jCCVj.js";const z={title:"Calendar/Agenda panels",parameters:{layout:"padded",docs:{description:{component:`The readings beside the strip. None of them repeats the list — each answers
something the rows cannot answer at a glance.`}}}},s="2026-06-10",y=`${s}T09:15:00+02:00`,g="+02:00",j=[{id:"work",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"personal",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"}];function t(r,a,D,N,b,O,A=""){return{id:r,calendarId:D,title:a,start:`${N}T${b}:00${g}`,end:`${N}T${O}:00${g}`,allDay:!1,location:A,notes:"",attendees:[],myRsvp:"accepted",threadId:"",threadSubject:"",timeZone:"Europe/Amsterdam",zoneCertainty:"explicit",recurrenceRule:"",seriesId:"",seriesException:!1,status:"confirmed"}}const f=[t("evt_standup","Standup","work",s,"09:00","09:30"),t("evt_roadmap","Q3 roadmap review","work",s,"10:00","11:30","Kaap"),t("evt_lunch","Lunch with Jane","personal",s,"12:30","13:30"),t("evt_retro","Retro","work",s,"16:00","17:00"),t("evt_dentist","Dentist","personal","2026-06-11","14:00","14:45")],P=["2026-06-10","2026-06-11","2026-06-12","2026-06-13","2026-06-14"],l=P.map(r=>T(r,f,s)),k=r=>T(r,f,s),v={calendars:j,today:s,onSelectEvent:()=>{},onGoTo:()=>{}},n={render:()=>e.jsx(x,{...v,nextUp:h(l,y),className:"max-w-80"})},o={render:()=>e.jsx(x,{...v,nextUp:h(l,"2026-06-14T21:00:00+02:00"),className:"max-w-80"})},c={render:()=>e.jsx(x,{...v,nextUp:h(l,y),touch:!0,className:"max-w-80"})},i={render:()=>{const[r,a]=w.useState("pills");return e.jsxs("div",{className:"flex flex-col gap-4",children:[e.jsx(u,{value:r,onChange:a}),e.jsx(u,{value:r,onChange:a,icons:!0}),e.jsx(u,{value:r,onChange:a,touch:!0,icons:!0})]})}},d={render:()=>e.jsx("div",{className:"max-w-80",children:e.jsx(U,{stretches:C(l,y,5),today:s,onPick:()=>{}})})},p={render:()=>e.jsx("div",{className:"max-w-80",children:e.jsx(U,{stretches:[],today:s,onPick:()=>{}})})},m={render:()=>{const[r,a]=w.useState("2026-06-11");return e.jsx("div",{className:"max-w-64",children:e.jsx(S,{anchorDate:s,visibleDate:r,today:s,dayOf:k,onGoTo:a})})}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <NextUpCard {...nextUpProps} nextUp={readNextUp(days, NOW)} className="max-w-80" />
}`,...n.parameters?.docs?.source},description:{story:"Something is running and something is coming: both, in one sentence each.",...n.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <NextUpCard {...nextUpProps} nextUp={readNextUp(days, "2026-06-14T21:00:00+02:00")} className="max-w-80" />
}`,...o.parameters?.docs?.source},description:{story:'The end of a day, where "nothing else" is the whole answer.',...o.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <NextUpCard {...nextUpProps} nextUp={readNextUp(days, NOW)} touch className="max-w-80" />
}`,...c.parameters?.docs?.source},description:{story:"Grown for a rail a thumb reaches.",...c.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [value, setValue] = useState<"dots" | "pills" | "detail">("pills");
    return <div className="flex flex-col gap-4">
                <AgendaDensityControl value={value} onChange={setValue} />
                <AgendaDensityControl value={value} onChange={setValue} icons />
                <AgendaDensityControl value={value} onChange={setValue} touch icons />
            </div>;
  }
}`,...i.parameters?.docs?.source},description:{story:"Three readings, not two, and the control never leaves the screen.",...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-80">
            <FreeTimeList stretches={freeAhead(days, NOW, 5)} today={TODAY} onPick={() => {}} />
        </div>
}`,...d.parameters?.docs?.source},description:{story:"Empty time, listed like anything else that is on the calendar.",...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-80">
            <FreeTimeList stretches={[] as FreeStretch[]} today={TODAY} onPick={() => {}} />
        </div>
}`,...p.parameters?.docs?.source},description:{story:"Nothing open is a sentence, never an empty box.",...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [visible, setVisible] = useState("2026-06-11");
    return <div className="max-w-64">
                <PositionMap anchorDate={TODAY} visibleDate={visible} today={TODAY} dayOf={dayOf} onGoTo={setVisible} />
            </div>;
  }
}`,...m.parameters?.docs?.source},description:{story:"A scrollbar with meaning: how full each day is, and where you are parked.",...m.parameters?.docs?.description}}};const J=["NextUpRunning","NextUpDone","NextUpTouch","Density","OpenTime","NoOpenTime","WhereYouAre"];export{i as Density,o as NextUpDone,n as NextUpRunning,c as NextUpTouch,p as NoOpenTime,d as OpenTime,m as WhereYouAre,J as __namedExportsOrder,z as default};
