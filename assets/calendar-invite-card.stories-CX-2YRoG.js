import{r as g,j as s}from"./iframe-uufGNBEn.js";import{C as u}from"./calendar-invite-card-Bsrui_DD.js";import{d as v,k as h}from"./intelligence-calendar-fixtures-CQpmTb9F.js";import"./preload-helper-PPVm8Dsz.js";import"./calendar-color-CqvBY603.js";import"./cn-d2XQ1MEC.js";import"./attendee-row-DkgrLHvh.js";import"./avatar-B5mDLuXx.js";import"./minus-WgJswgYh.js";import"./createLucideIcon-Bn-Stmx4.js";import"./x-CuwWA0oJ.js";import"./clock-Cx4gZNlA.js";import"./check-BSgP79ub.js";import"./button-Wi0n0Lyz.js";import"./calendar-clash-strip-D9om_lyL.js";import"./triangle-alert-BMnL-Txz.js";import"./calendar-parse-badge-CoW4c8u0.js";import"./file-text-wmSXByn2.js";import"./map-pin-DUH0Cs8a.js";import"./trash-2-RI1RlAl9.js";const q={title:"Calendar/Invite card",component:u,parameters:{layout:"padded",docs:{description:{component:`The invitation as the thing it is, rather than an attachment nobody opens.
What saying yes runs into is stated above the button, and the card says the
organiser hears nothing — this plan sends no reply at all.`}}},decorators:[m=>s.jsx("div",{className:"max-w-md",children:s.jsx(m,{})})]},y={onAdd:()=>{},onTentative:()=>{},onDecline:()=>{},onReopen:()=>{},onOfferOtherTimes:()=>{}},e={invite:h,whenText:"Thursday 11 June, 14:00 – 15:00",calendarName:"Work",color:"cal-2",clashes:v,rsvp:"noReply",...y},f={...h,state:"superseded",sequence:1,evidence:"invite.ics · METHOD:REQUEST · SEQUENCE:1"},x={...h,state:"cancelled",sequence:2,evidence:"cancel.ics · METHOD:CANCEL · STATUS:CANCELLED"},r={args:e},a={args:{...e,clashes:[]}},t={args:{...e,rsvp:"accepted",clashes:[]}},n={args:{...e,rsvp:"declined",clashes:[]}},o={args:{...e,invite:f,onOpenNewer:()=>{}}},i={args:{...e,invite:x,rsvp:"accepted",onRemove:()=>{}}},c={args:{...e,guests:s.jsxs("ul",{className:"flex flex-col gap-0.5 text-xs text-fg-muted",children:[s.jsx("li",{children:"Priya Natarajan — organiser"}),s.jsx("li",{children:"Marcus Webb — coming"}),s.jsx("li",{children:"Dana Okafor — no reply"})]})}},d={args:{...e,touch:!0}},p={render:()=>{const[m,l]=g.useState("noReply");return s.jsx(u,{...e,rsvp:m,onAdd:()=>l("accepted"),onTentative:()=>l("tentative"),onDecline:()=>l("declined"),onReopen:()=>l("noReply")})}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: base
}`,...r.parameters?.docs?.source},description:{story:"The clash stated before the answer, which is the whole point of the card.",...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    clashes: []
  }
}`,...a.parameters?.docs?.source},description:{story:"The same invitation on an empty afternoon. Silence would read as unchecked.",...a.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    rsvp: "accepted",
    clashes: []
  }
}`,...t.parameters?.docs?.source},description:{story:"Answered. The card keeps saying the organiser was never told.",...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    rsvp: "declined",
    clashes: []
  }
}`,...n.parameters?.docs?.source},description:{story:"Declined, with the way back to offering other times still open.",...n.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    invite: superseded,
    onOpenNewer: () => undefined
  }
}`,...o.parameters?.docs?.source},description:{story:"A later message carried a higher SEQUENCE, so this one is not the question.",...o.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    invite: cancelled,
    rsvp: "accepted",
    onRemove: () => undefined
  }
}`,...i.parameters?.docs?.source},description:{story:"Cancelled, and still on the calendar until the reader takes it off.",...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    guests: <ul className="flex flex-col gap-0.5 text-xs text-fg-muted">
                <li>Priya Natarajan — organiser</li>
                <li>Marcus Webb — coming</li>
                <li>Dana Okafor — no reply</li>
            </ul>
  }
}`,...c.parameters?.docs?.source},description:{story:"A host with its own guest surface passes it in rather than growing a second.",...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    ...base,
    touch: true
  }
}`,...d.parameters?.docs?.source},description:{story:"Thumb-sized targets, wrapped so three answers fit a phone.",...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [rsvp, setRsvp] = useState<RsvpState>("noReply");
    return <CalendarInviteCard {...base} rsvp={rsvp} onAdd={() => setRsvp("accepted")} onTentative={() => setRsvp("tentative")} onDecline={() => setRsvp("declined")} onReopen={() => setRsvp("noReply")} />;
  }
}`,...p.parameters?.docs?.source},description:{story:"The card answering for real, so the review is a click-through.",...p.parameters?.docs?.description}}};const Q=["WithAClash","NothingBooked","AlreadyOnTheCalendar","Declined","OvertakenByANewerRevision","Cancelled","WithTheHostsGuestList","Touch","Answering"];export{t as AlreadyOnTheCalendar,p as Answering,i as Cancelled,n as Declined,a as NothingBooked,o as OvertakenByANewerRevision,d as Touch,r as WithAClash,c as WithTheHostsGuestList,Q as __namedExportsOrder,q as default};
