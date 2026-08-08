import{j as a}from"./iframe-uTafckjr.js";import{E as s}from"./event-suggestion-card--jAayJ2Z.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./button-DCXIHjmE.js";import"./x-DS_pud-s.js";import"./createLucideIcon-DLYy-DY-.js";import"./triangle-alert-nDKVGVDQ.js";import"./mail-L6Y6Rsvz.js";import"./plus-B0i1ZMv7.js";const T={title:"Calendar/Suggestion card",component:s,parameters:{layout:"padded",docs:{description:{component:`What the reader found in a mail, waiting for a person. It sits on a dashed
card off the grid: a suggestion is never a provisional event that someone has
to notice and take back off the calendar.`}}},decorators:[i=>a.jsx("div",{className:"max-w-sm",children:a.jsx(i,{})})]},r={id:"s1",title:"Stay in Lisbon",start:"2026-06-19",end:"2026-06-23",allDay:!0,location:"Alfama, Lisbon",threadId:"thr_airbnb",threadSubject:"Your reservation in Lisbon is confirmed",sender:"Airbnb",confidence:.94,ambiguity:"",suggestedCalendarId:"c5",timeZone:"Europe/Lisbon",zoneCertainty:"explicit"},n={onAdd:()=>{},onReview:()=>{},onDismiss:()=>{},onOpenThread:()=>{}},e={render:()=>a.jsx(s,{suggestion:r,whenText:"Friday 19 June – Monday 22 June",...n})},t={render:()=>a.jsx(s,{suggestion:{...r,id:"s2",title:"Analytics pilot — first call",allDay:!1,location:"",threadSubject:"Following up: analytics pilot proposal",sender:"Erik Wahlberg",confidence:.38,ambiguity:'Asked for "some time Tuesday" and named no hour. Two Tuesdays fit.'},whenText:"Tuesday 16 June · 09:00 – 10:00",...n})},o={render:()=>a.jsx(s,{suggestion:r,whenText:"Friday 19 June – Monday 22 June",touch:!0,...n})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  render: () => <EventSuggestionCard suggestion={base} whenText="Friday 19 June – Monday 22 June" {...handlers} />
}`,...e.parameters?.docs?.source},description:{story:"A booking mail that gave every field it needed to.",...e.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
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
}`,...t.parameters?.docs?.source},description:{story:"What it could not settle is named, not smoothed over.",...t.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <EventSuggestionCard suggestion={base} whenText="Friday 19 June – Monday 22 June" touch {...handlers} />
}`,...o.parameters?.docs?.source},description:{story:"The same card sized for a phone sheet.",...o.parameters?.docs?.description}}};const x=["ReadCleanly","WithAmbiguity","Touch"];export{e as ReadCleanly,o as Touch,t as WithAmbiguity,x as __namedExportsOrder,T as default};
