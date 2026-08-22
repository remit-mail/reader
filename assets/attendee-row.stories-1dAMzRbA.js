import{j as e}from"./iframe-BxLfZl0d.js";import{R as a,A as t}from"./attendee-row-DL_l3O00.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./avatar-B9NbFnlE.js";import"./minus-D96JXrD1.js";import"./createLucideIcon-DDkWk8mg.js";import"./x-BYZsfpI2.js";import"./clock-L-8RlEWY.js";import"./check-DP9bkLrx.js";const u={title:"Calendar/Attendees",parameters:{layout:"padded",docs:{description:{component:`Who is coming, and whether they said so. The reply is words and a mark, never
a colour on its own.`}}}},n=[{name:"Priya Natarajan",email:"priya@northwind.example",rsvp:"accepted",role:"organizer"},{name:"Marcus Webb",email:"marcus@northwind.example",rsvp:"accepted",role:"attendee"},{name:"Dana Okafor",email:"dana@northwind.example",rsvp:"tentative",role:"attendee"},{name:"Aisha Khan",email:"aisha@northwind.example",rsvp:"noReply",role:"attendee"},{name:"Sven Larsen",email:"sven@northwind.example",rsvp:"declined",role:"attendee"}],r={render:()=>e.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface p-3",children:e.jsx(t,{attendees:n})})},s={render:()=>e.jsxs("div",{className:"flex gap-4",children:[e.jsx(a,{rsvp:"accepted"}),e.jsx(a,{rsvp:"tentative"}),e.jsx(a,{rsvp:"declined"}),e.jsx(a,{rsvp:"noReply"})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-sm rounded-lg border border-line bg-surface p-3">
            <AttendeeList attendees={attendees} />
        </div>
}`,...r.parameters?.docs?.source},description:{story:"A full guest list, with the tally read off it rather than stated twice.",...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex gap-4">
            <RsvpBadge rsvp="accepted" />
            <RsvpBadge rsvp="tentative" />
            <RsvpBadge rsvp="declined" />
            <RsvpBadge rsvp="noReply" />
        </div>
}`,...s.parameters?.docs?.source}}};const g=["List","EveryReply"];export{s as EveryReply,r as List,g as __namedExportsOrder,u as default};
