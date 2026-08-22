import{j as o}from"./iframe-BxLfZl0d.js";import{E as s}from"./event-suggestion-card-ax2X79EV.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./button-y3nctzTP.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";import"./triangle-alert-C1LDOpRR.js";import"./mail-1A9kE0lO.js";import"./plus-BBNcy7LS.js";const f={title:"Calendar/Suggestion card",component:s,parameters:{layout:"padded",docs:{description:{component:`What the reader found in a mail, waiting for a person. It sits on a dashed
card off the grid: a suggestion is never a provisional event that someone has
to notice and take back off the calendar.`}}},decorators:[i=>o.jsx("div",{className:"max-w-sm",children:o.jsx(i,{})})]},r={id:"s1",title:"Stay in Lisbon",start:"2026-06-19",end:"2026-06-23",allDay:!0,location:"Alfama, Lisbon",threadId:"thr_airbnb",threadSubject:"Your reservation in Lisbon is confirmed",sender:"Airbnb",senderAddress:"automated@airbnb.example",confidence:.94,ambiguity:"",suggestedCalendarId:"c5",timeZone:"Europe/Lisbon",zoneCertainty:"explicit"},n={onAdd:()=>{},onReview:()=>{},onDismiss:()=>{},onOpenThread:()=>{}},e={render:()=>o.jsx(s,{suggestion:r,whenText:"Friday 19 June – Monday 22 June",...n})},a={render:()=>o.jsx(s,{suggestion:{...r,id:"s2",title:"Analytics pilot — first call",allDay:!1,location:"",threadSubject:"Following up: analytics pilot proposal",sender:"Erik Wahlberg",confidence:.38,ambiguity:'Asked for "some time Tuesday" and named no hour. Two Tuesdays fit.'},whenText:"Tuesday 16 June · 09:00 – 10:00",...n})},t={render:()=>o.jsx(s,{suggestion:r,whenText:"Friday 19 June – Monday 22 June",touch:!0,...n})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  render: () => <EventSuggestionCard suggestion={base} whenText="Friday 19 June – Monday 22 June" {...handlers} />
}`,...e.parameters?.docs?.source},description:{story:"A booking mail that gave every field it needed to.",...e.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <EventSuggestionCard suggestion={{
    ...base,
    id: "s2",
    title: "Analytics pilot — first call",
    allDay: false,
    location: "",
    threadSubject: "Following up: analytics pilot proposal",
    sender: "Erik Wahlberg",
    confidence: 0.38,
    ambiguity: 'Asked for "some time Tuesday" and named no hour. Two Tuesdays fit.'
  }} whenText="Tuesday 16 June · 09:00 – 10:00" {...handlers} />
}`,...a.parameters?.docs?.source},description:{story:"What it could not settle is named, not smoothed over.",...a.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <EventSuggestionCard suggestion={base} whenText="Friday 19 June – Monday 22 June" touch {...handlers} />
}`,...t.parameters?.docs?.source},description:{story:"The same card sized for a phone sheet.",...t.parameters?.docs?.description}}};const x=["ReadCleanly","WithAmbiguity","Touch"];export{e as ReadCleanly,t as Touch,a as WithAmbiguity,x as __namedExportsOrder,f as default};
