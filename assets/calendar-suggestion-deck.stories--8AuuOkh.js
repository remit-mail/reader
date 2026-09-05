import{j as t,r as c}from"./iframe-uufGNBEn.js";import{C as k}from"./calendar-suggestion-deck-B4abb1UG.js";import{s as C,Z as v,E as w}from"./event-suggestion-card-qc4GCypU.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./sparkles-CHnxu8zM.js";import"./createLucideIcon-Bn-Stmx4.js";import"./blocked-reason-C4Upi9m5.js";import"./button-Wi0n0Lyz.js";import"./x-CuwWA0oJ.js";import"./triangle-alert-BMnL-Txz.js";import"./mail-DXm5QBOT.js";import"./globe-axgt3PNC.js";import"./plus-ZS84sF7u.js";const K={title:"Calendar/Suggestion deck",component:k,parameters:{layout:"padded",docs:{description:{component:`Readings one at a time. The swipe is the fast path over the buttons that are
always there under it, so a gesture is never the only way to answer — and it
is refused on the same terms the buttons are, because a swipe that books a
time nobody placed on a clock is the mistake, not the shortcut.`}}},decorators:[d=>t.jsx("div",{className:"max-w-sm",children:t.jsx(d,{})})]},y={id:"sug_flight",title:"KL1693 Amsterdam → Lisbon",start:"2026-06-19T18:40:00+02:00",end:"2026-06-19T20:25:00+02:00",allDay:!1,location:"Schiphol, gate D-pier",threadId:"thr_klm",threadSubject:"Your booking is confirmed — KL1693 Amsterdam to Lisbon",sender:"KLM",senderAddress:"noreply@klm.example",confidence:.88,ambiguity:"The confirmation prints 20:25 for the arrival and never says whose clock.",suggestedCalendarId:"cal_travel",timeZone:"",zoneCertainty:"ambiguous",zoneOptions:[{timeZone:"Europe/Lisbon",label:"20:25 in Lisbon",note:"21:25 on your own clock."},{timeZone:"Europe/Amsterdam",label:"20:25 in Amsterdam",note:"19:25 where the plane lands."}]},a={...y,id:"sug_dinner",title:"Dinner with Rita",ambiguity:"",timeZone:"Europe/Amsterdam",zoneCertainty:"explicit",zoneOptions:void 0},j={onDismiss:()=>{},onOpenThread:()=>{}};function l({queue:d}){const[m,b]=c.useState(d),[p,u]=c.useState(""),[h,g]=c.useState(""),e=m[0],i=e===void 0?void 0:C(e,p),f=()=>{b(x=>x.slice(1)),u("")};return t.jsxs("div",{className:"flex flex-col gap-2",children:[t.jsx(k,{hasCard:e!==void 0,remaining:m.length,blocked:i!==void 0&&!i.settled,blockedReason:v,confirmLabel:"Add",onConfirm:()=>{e&&i?.settled&&(g(`added ${e.title} on ${i.timeZone||"its own clock"}`),f())},onReject:()=>{e&&g(`dropped ${e.title}`),f()},children:e&&t.jsx(w,{...j,suggestion:e,whenText:"Friday 19 June · 18:40 – 20:25",zoneChoice:p,onZoneChoice:u,onAdd:()=>{},onReview:()=>{}})}),h!==""&&t.jsxs("p",{className:"text-2xs text-fg-subtle",children:["Prototype: ",h]})]})}const o={render:()=>t.jsx(l,{queue:[y]})},s={render:()=>t.jsx(l,{queue:[a]})},n={render:()=>t.jsx(l,{queue:[a,{...a,id:"sug_haircut",title:"Haircut"},{...a,id:"sug_mot",title:"Car inspection"}]})},r={args:{hasCard:!1,remaining:0,blocked:!1,blockedReason:"",onConfirm:()=>{},onReject:()=>{},children:null}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Deck queue={[flight]} />
}`,...o.parameters?.docs?.source},description:{story:"The clock is unstated, so the swipe says why it will not commit.",...o.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <Deck queue={[stated]} />
}`,...s.parameters?.docs?.source},description:{story:"The mail already said which clock, so the deck is live from the start.",...s.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Deck queue={[stated, {
    ...stated,
    id: "sug_haircut",
    title: "Haircut"
  }, {
    ...stated,
    id: "sug_mot",
    title: "Car inspection"
  }]} />
}`,...n.parameters?.docs?.source},description:{story:"A queue, counted, so the reader knows what answering buys them.",...n.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    hasCard: false,
    remaining: 0,
    blocked: false,
    blockedReason: "",
    onConfirm: () => undefined,
    onReject: () => undefined,
    children: null
  }
}`,...r.parameters?.docs?.source},description:{story:"Nothing left. The empty deck says so in the reader's own terms.",...r.parameters?.docs?.description}}};const U=["HeldOnAnUnsettledClock","ReadyToConfirm","AQueueOfThree","NothingWaiting"];export{n as AQueueOfThree,o as HeldOnAnUnsettledClock,r as NothingWaiting,s as ReadyToConfirm,U as __namedExportsOrder,K as default};
