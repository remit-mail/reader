import{j as e,r as p}from"./iframe-uufGNBEn.js";import{E as r}from"./event-suggestion-card-qc4GCypU.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./blocked-reason-C4Upi9m5.js";import"./button-Wi0n0Lyz.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";import"./triangle-alert-BMnL-Txz.js";import"./mail-DXm5QBOT.js";import"./globe-axgt3PNC.js";import"./plus-ZS84sF7u.js";const W={title:"Calendar/Suggestion card",component:r,parameters:{layout:"padded",docs:{description:{component:`What the reader found in a mail, waiting for a person. It sits on a dashed
card off the grid: a suggestion is never a provisional event that someone has
to notice and take back off the calendar.`}}},decorators:[d=>e.jsx("div",{className:"max-w-sm",children:e.jsx(d,{})})]},i={id:"s1",title:"Stay in Lisbon",start:"2026-06-19",end:"2026-06-23",allDay:!0,location:"Alfama, Lisbon",threadId:"thr_airbnb",threadSubject:"Your reservation in Lisbon is confirmed",sender:"Airbnb",senderAddress:"automated@airbnb.example",confidence:.94,ambiguity:"",suggestedCalendarId:"c5",timeZone:"Europe/Lisbon",zoneCertainty:"explicit"},l={onAdd:()=>{},onReview:()=>{},onDismiss:()=>{},onOpenThread:()=>{}},o={render:()=>e.jsx(r,{suggestion:i,whenText:"Friday 19 June – Monday 22 June",...l})},n={render:()=>e.jsx(r,{suggestion:{...i,id:"s2",title:"Analytics pilot — first call",allDay:!1,location:"",threadSubject:"Following up: analytics pilot proposal",sender:"Erik Wahlberg",confidence:.38,ambiguity:'Asked for "some time Tuesday" and named no hour. Two Tuesdays fit.'},whenText:"Tuesday 16 June · 09:00 – 10:00",...l})},b=[{timeZone:"Europe/Lisbon",label:"16:00 in Lisbon",note:"17:00 on your own clock. The hour she keeps."},{timeZone:"Europe/Amsterdam",label:"16:00 in Amsterdam",note:"15:00 where she is."}],f={...i,id:"s3",title:"Kickoff call — Lisbon venue",allDay:!1,location:"Meet link",threadSubject:"Kickoff call on Wednesday at 16:00",sender:"Rita Sousa",confidence:.66,ambiguity:"Rita writes from Lisbon and names 16:00 without a clock. Lisbon runs an hour behind Amsterdam.",timeZone:"",zoneCertainty:"ambiguous",zoneOptions:b};function h({picked:d}){const[g,y]=p.useState(d),[m,u]=p.useState("");return e.jsxs("div",{className:"flex flex-col gap-2",children:[e.jsx(r,{suggestion:f,whenText:"Wednesday 17 June · 16:00 – 17:00",zoneChoice:g,onZoneChoice:y,onAdd:c=>u(`Added on ${c}`),onReview:c=>u(`Editor opened on ${c}`),onDismiss:()=>{},onOpenThread:()=>{}}),e.jsx("p",{className:"text-2xs text-fg-subtle",children:m===""?"Nothing has left the card yet.":m})]})}const t={name:"The zone we cannot determine",render:()=>e.jsx(h,{picked:""})},s={name:"The clock is picked",render:()=>e.jsx(h,{picked:"Europe/Lisbon"})},a={render:()=>e.jsx(r,{suggestion:i,whenText:"Friday 19 June – Monday 22 June",touch:!0,...l})};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <EventSuggestionCard suggestion={base} whenText="Friday 19 June – Monday 22 June" {...handlers} />
}`,...o.parameters?.docs?.source},description:{story:"A booking mail that gave every field it needed to.",...o.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
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
}`,...n.parameters?.docs?.source},description:{story:"What it could not settle is named, not smoothed over.",...n.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "The zone we cannot determine",
  render: () => <GatedCall picked="" />
}`,...t.parameters?.docs?.source},description:{story:`The mail printed an hour and never said whose clock it is on. Both ways out
of the card are dimmed and stay dimmed until one is picked — an hour guessed
wrong is a call missed, and an editor opened on that hour hides the guess
behind a field the reader is invited to trust.`,...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "The clock is picked",
  render: () => <GatedCall picked="Europe/Lisbon" />
}`,...s.parameters?.docs?.source},description:{story:`Answered. Both buttons are live, and each carries the clock that was named —
Add books it, Change first opens on it.`,...s.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <EventSuggestionCard suggestion={base} whenText="Friday 19 June – Monday 22 June" touch {...handlers} />
}`,...a.parameters?.docs?.source},description:{story:"The same card sized for a phone sheet.",...a.parameters?.docs?.description}}};const Z=["ReadCleanly","WithAmbiguity","ZoneWeCannotDetermine","ZonePicked","Touch"];export{o as ReadCleanly,a as Touch,n as WithAmbiguity,s as ZonePicked,t as ZoneWeCannotDetermine,Z as __namedExportsOrder,W as default};
