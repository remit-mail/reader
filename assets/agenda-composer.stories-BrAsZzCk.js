import{j as p,r as t}from"./iframe-uufGNBEn.js";import{A as g,a as E}from"./agenda-composer-Bg_cCK53.js";import"./preload-helper-PPVm8Dsz.js";import"./agenda-time-DsDLGX47.js";import"./apiHelpers-DnyaISng.js";import"./cn-d2XQ1MEC.js";import"./event-editor-DHQ0xvYE.js";import"./calendar-color-CqvBY603.js";import"./recurrence-BtiVw_PT.js";import"./button-Wi0n0Lyz.js";import"./input-Cs8KaoXd.js";import"./select-jAwdmlAP.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";import"./repeat-BnlNct4V.js";import"./wand-sparkles-eM_wlEts.js";import"./triangle-alert-BMnL-Txz.js";import"./info-CzU_cXHr.js";const V={title:"Calendar/Agenda composer",component:g,parameters:{layout:"padded",docs:{description:{component:`Correcting the machine happens before the event exists. The sentence is read
back with the words each part came from, and where it has two honest
readings the composer asks rather than choosing.`}}},decorators:[h=>p.jsx("div",{className:"max-w-96",children:p.jsx(h,{})})]},A=[{id:"work",accountId:"a1",accountLabel:"Work",name:"Northwind",color:"cal-1"},{id:"personal",accountId:"a2",accountLabel:"Personal",name:"Family",color:"cal-3"}],d={title:"Lunch with Jane",date:"2026-06-12",startTime:"13:00",endTime:"14:00",allDay:!1,calendarId:"work",location:"",guests:"Jane",notes:"",repeat:""},u={title:"Lunch with Jane",date:"2026-06-12",dateText:"friday",startTime:"13:00",startTimeText:"1pm",endTime:"14:00",durationMinutes:60,durationText:"",attendees:["Jane"],attendeesText:"with Jane",location:"",locationText:"",repeat:"",repeatText:"",assumptions:["An hour long, because the sentence never said."],unresolved:[],choices:[]},M={...u,title:"Standup",startTime:"09:30",endTime:"09:45",startTimeText:"9:30",dateText:"every weekday",repeat:"Every weekday",repeatText:"every weekday",attendees:[],attendeesText:"",assumptions:["Fifteen minutes, because the sentence never said."]},l={...u,title:"Coffee with Marcus",startTime:"08:00",startTimeText:"at 8",endTime:"09:00",attendees:["Marcus"],attendeesText:"with Marcus",unresolved:["No place given."],choices:[{id:"which_eight",question:"Eight in the morning or eight at night?",source:"at 8",options:[{id:"am",label:"08:00",date:"",startTime:"08:00"},{id:"pm",label:"20:00",date:"",startTime:"20:00"}],chosenId:"am"}]},e={onPhraseChange:()=>{},picks:{},onPick:()=>{},draft:d,onDraftChange:()=>{},calendars:A,expanded:!1,onToggleExpanded:()=>{},onSave:()=>{},onCancel:()=>{},onOpen:()=>{}},a={render:()=>p.jsx(E,{phrase:"",onPhraseChange:()=>{},onOpen:()=>{},onCommit:()=>{}})},r={args:{...e,phrase:"lunch with Jane friday 1pm",parse:u,open:!0}},s={args:{...e,phrase:"standup every weekday 9:30",parse:M,draft:{...d,title:"Standup",repeat:"Every weekday"},open:!0}},n={args:{...e,phrase:"coffee with Marcus at 8",parse:l,draft:{...d,title:"Coffee with Marcus",startTime:"08:00"},open:!0}},o={args:{...e,phrase:"lunch with Jane friday 1pm",parse:u,open:!1}},i={args:{...e,phrase:"coffee with Marcus at 8",parse:l,open:!0,touch:!0}},c={render:()=>{const[h,f]=t.useState({}),[w,y]=t.useState("coffee with Marcus at 8"),[T,x]=t.useState(!0),[k,b]=t.useState(!1),[v,C]=t.useState(d);return p.jsx(g,{...e,phrase:w,onPhraseChange:y,parse:l,picks:h,onPick:(m,S)=>f(P=>({...P,[m]:S})),draft:v,onDraftChange:C,expanded:k,onToggleExpanded:()=>b(m=>!m),open:T,onOpen:()=>x(!0)})}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <AgendaPhraseField phrase="" onPhraseChange={() => {}} onOpen={() => {}} onCommit={() => {}} />
}`,...a.parameters?.docs?.source},description:{story:"The field on its own — where the composer starts every time.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    phrase: "lunch with Jane friday 1pm",
    parse,
    open: true
  }
}`,...r.parameters?.docs?.source},description:{story:"A sentence that read cleanly, with the reading shown back above the form.",...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    phrase: "standup every weekday 9:30",
    parse: repeating,
    draft: {
      ...draft,
      title: "Standup",
      repeat: "Every weekday"
    },
    open: true
  }
}`,...s.parameters?.docs?.source},description:{story:"A rule the sentence carried, named as a rule rather than as one morning.",...s.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    phrase: "coffee with Marcus at 8",
    parse: ambiguous,
    draft: {
      ...draft,
      title: "Coffee with Marcus",
      startTime: "08:00"
    },
    open: true
  }
}`,...n.parameters?.docs?.source},description:{story:"Two honest readings: the question is a control, and the answer is one tap.",...n.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    phrase: "lunch with Jane friday 1pm",
    parse,
    open: false
  }
}`,...o.parameters?.docs?.source},description:{story:"Folded away until there is something to correct.",...o.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    phrase: "coffee with Marcus at 8",
    parse: ambiguous,
    open: true,
    touch: true
  }
}`,...i.parameters?.docs?.source},description:{story:"Grown for a phone, where the form is the whole screen.",...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [picks, setPicks] = useState<ChoicePicks>({});
    const [phrase, setPhrase] = useState("coffee with Marcus at 8");
    const [open, setOpen] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const [current, setCurrent] = useState(draft);
    return <AgendaComposer {...base} phrase={phrase} onPhraseChange={setPhrase} parse={ambiguous} picks={picks} onPick={(choiceId, optionId) => setPicks(previous => ({
      ...previous,
      [choiceId]: optionId
    }))} draft={current} onDraftChange={setCurrent} expanded={expanded} onToggleExpanded={() => setExpanded(value => !value)} open={open} onOpen={() => setOpen(true)} />;
  }
}`,...c.parameters?.docs?.source},description:{story:"Answering the question moves the reading; nothing is settled behind you.",...c.parameters?.docs?.description}}};const X=["FieldOnly","Read","Repeating","Ambiguous","Folded","Touch","Interactive"];export{n as Ambiguous,a as FieldOnly,o as Folded,c as Interactive,r as Read,s as Repeating,i as Touch,X as __namedExportsOrder,V as default};
