import{j as e}from"./iframe-zw88L4Mq.js";import{C as r,b as u}from"./message-row-CcCINhiH.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./roving-focus-5ii5MRPr.js";import"./app-shell-types-LVfosKXZ.js";import"./avatar-CZJ-LrXe.js";import"./badge-Ee126ieB.js";import"./label-chip-DCJIAgrz.js";import"./shield-alert-C0MDecMU.js";import"./createLucideIcon-AdIgPHc_.js";import"./star-Dn8uDbft.js";import"./paperclip-CYiOVWYx.js";import"./check-DQN2CS7b.js";const h={id:"r-read",accountId:"a1",fromName:"Alex Rivera",fromEmail:"alex@example.com",subject:"Re: Q3 planning notes",snippet:"Sounds good — I pushed the deck to the shared drive.",timeLabel:"9:42",isRead:!0},b={id:"r-unread",accountId:"a1",fromName:"Priya Nair",fromEmail:"priya@example.com",subject:"Design review tomorrow",snippet:"Can we move it to 2pm? I have a conflict in the morning.",timeLabel:"8:15",isRead:!1,messageCount:3},f={id:"r-starred",accountId:"a1",fromName:"Sam Okafor",fromEmail:"sam@example.com",subject:"Contract signed",snippet:"Attaching the countersigned PDF for your records.",timeLabel:"Mon",isRead:!0,starred:!0},g={id:"r-suspicious",accountId:"a1",fromName:"Account Security",fromEmail:"no-reply@secure-update.example",subject:"Verify your account immediately",snippet:"Your account will be suspended unless you confirm now.",timeLabel:"Tue",isRead:!1,suspicious:!0},y={id:"r-attachment",accountId:"a1",fromName:"Dana Lopez",fromEmail:"dana@example.com",subject:"Invoice for May",snippet:"Please find the attached invoice, due end of month.",timeLabel:"Wed",isRead:!0,hasAttachment:!0},L={id:"r-category",accountId:"a1",fromName:"The Weekly Brief",fromEmail:"hello@weekly.example",subject:"This week in product",snippet:"Five stories you might have missed this week.",timeLabel:"Thu",isRead:!1,category:"newsletter"},C={id:"r-no-label",accountId:"a1",fromName:"Jordan Lee",fromEmail:"jordan@example.com",subject:"Lunch on Friday?",snippet:"Thinking the usual place, around noon.",timeLabel:"10:03",isRead:!0},k={id:"r-one-label",accountId:"a1",fromName:"Stripe",fromEmail:"receipts@stripe.com",subject:"Your receipt from Acme Co",snippet:"Payment of $42.00 was successful.",timeLabel:"9:10",isRead:!0,labels:[{labelId:"l1",name:"Receipts",color:"Blue"}]},x={id:"r-two-labels",accountId:"a1",fromName:"United Airlines",fromEmail:"noreply@united.com",subject:"Your itinerary for SFO → JFK",snippet:"Check-in opens 24 hours before departure.",timeLabel:"Yesterday",isRead:!1,labels:[{labelId:"l1",name:"Receipts",color:"Blue"},{labelId:"l2",name:"Travel",color:"Green"}]},j={id:"r-several-labels",accountId:"a1",fromName:"Finance Team",fromEmail:"finance@example.com",subject:"Q3 budget review — action needed",snippet:"Please review the attached numbers before Thursday.",timeLabel:"Mon",isRead:!1,labels:[{labelId:"l1",name:"Receipts",color:"Blue"},{labelId:"l2",name:"Travel",color:"Green"},{labelId:"l3",name:"Urgent",color:"Red"},{labelId:"l4",name:"Work",color:"Purple"}]},R={id:"r-long-label",accountId:"a1",fromName:"Compliance",fromEmail:"compliance@example.com",subject:"Filing due end of quarter",snippet:"One outstanding item on the checklist.",timeLabel:"Tue",isRead:!0,labels:[{labelId:"l5",name:"Quarterly compliance filings that need a second look",color:"Purple"}]},p=[C,k,x,j,R],w=[h,b,f,g,y,L],Q={title:"Primitives/MessageRow",parameters:{layout:"padded"}},t=({children:a})=>e.jsx("div",{className:"w-md divide-y divide-line rounded-md border border-line",children:a}),c={render:()=>e.jsx(t,{children:w.map(a=>e.jsx(r,{thread:a},a.id))})},l={render:()=>e.jsx(t,{children:w.map(a=>e.jsx(u,{thread:a},a.id))})},m={render:()=>e.jsxs(t,{children:[e.jsx(r,{thread:b,active:!0}),e.jsx(r,{thread:h,focused:!0}),e.jsx(r,{thread:f}),e.jsx(r,{thread:g})]})},o={render:()=>e.jsxs(t,{children:[e.jsx(r,{thread:b,selection:{checked:!0,onToggle:()=>{}}}),e.jsx(r,{thread:h,selection:{checked:!1,onToggle:()=>{}}}),e.jsx(r,{thread:f,selection:{checked:!1,alwaysVisible:!0,onToggle:()=>{}}}),e.jsx(r,{thread:L})]})},s={render:()=>e.jsx(t,{children:p.map(a=>e.jsx(r,{thread:a},a.id))})},n={name:"Comfortable Labels (dark)",parameters:{theme:"dark"},render:()=>e.jsx(t,{children:p.map(a=>e.jsx(r,{thread:a},a.id))})},d={render:()=>e.jsx(t,{children:p.map(a=>e.jsx(u,{thread:a},a.id))})},i={name:"Compact Labels (dark)",parameters:{theme:"dark"},render:()=>e.jsx(t,{children:p.map(a=>e.jsx(u,{thread:a},a.id))})};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <List>
            {all.map(thread => <ComfortableRow key={thread.id} thread={thread} />)}
        </List>
}`,...c.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <List>
            {all.map(thread => <CompactRow key={thread.id} thread={thread} />)}
        </List>
}`,...l.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <List>
            <ComfortableRow thread={unread} active />
            <ComfortableRow thread={read} focused />
            <ComfortableRow thread={starred} />
            <ComfortableRow thread={suspicious} />
        </List>
}`,...m.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <List>
            <ComfortableRow thread={unread} selection={{
      checked: true,
      onToggle: () => undefined
    }} />
            <ComfortableRow thread={read} selection={{
      checked: false,
      onToggle: () => undefined
    }} />
            <ComfortableRow thread={starred} selection={{
      checked: false,
      alwaysVisible: true,
      onToggle: () => undefined
    }} />
            <ComfortableRow thread={withCategory} />
        </List>
}`,...o.parameters?.docs?.source},description:{story:`Selectable rows. The checkbox layers over the avatar: hidden until hover
while unchecked, pinned visible once checked or while the list is in
multi-select mode. A row rendered without \`selection\` — the brief and
Flagged before they gained selection — shows the avatar alone.`,...o.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <List>
            {labeled.map(thread => <ComfortableRow key={thread.id} thread={thread} />)}
        </List>
}`,...s.parameters?.docs?.source},description:{story:`Labels (issue #26) alongside the existing read/unread, attachment and
category affordances — no label, one, two, several, and a long name that
truncates rather than growing the row. Comfortable density renders the
chips; compact does not (see \`CompactLabels\` below).`,...s.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Comfortable Labels (dark)",
  parameters: {
    theme: "dark"
  },
  render: () => <List>
            {labeled.map(thread => <ComfortableRow key={thread.id} thread={thread} />)}
        </List>
}`,...n.parameters?.docs?.source},description:{story:"The same labeled threads on the dark theme.",...n.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <List>
            {labeled.map(thread => <CompactRow key={thread.id} thread={thread} />)}
        </List>
}`,...d.parameters?.docs?.source},description:{story:"The same labeled threads in compact density. `CompactRowBody` carries no\nlabel rendering today — this documents that as the approved current\nbehavior, not an oversight in the story.",...d.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Compact Labels (dark)",
  parameters: {
    theme: "dark"
  },
  render: () => <List>
            {labeled.map(thread => <CompactRow key={thread.id} thread={thread} />)}
        </List>
}`,...i.parameters?.docs?.source},description:{story:"Compact density, dark theme.",...i.parameters?.docs?.description}}};const V=["Comfortable","Compact","States","Selectable","ComfortableLabels","ComfortableLabelsDark","CompactLabels","CompactLabelsDark"];export{c as Comfortable,s as ComfortableLabels,n as ComfortableLabelsDark,l as Compact,d as CompactLabels,i as CompactLabelsDark,o as Selectable,m as States,V as __namedExportsOrder,Q as default};
