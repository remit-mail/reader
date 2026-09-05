import{j as e,r as v}from"./iframe-uufGNBEn.js";import{R as s,A as m}from"./attendee-row-DkgrLHvh.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./avatar-B5mDLuXx.js";import"./minus-WgJswgYh.js";import"./createLucideIcon-Bn-Stmx4.js";import"./x-CuwWA0oJ.js";import"./clock-Cx4gZNlA.js";import"./check-BSgP79ub.js";const{expect:i,userEvent:p,waitFor:l,within:h}=__STORYBOOK_MODULE_TEST__,B={title:"Calendar/Attendees",parameters:{layout:"padded",docs:{description:{component:`Who is coming, and whether they said so. The reply is words and a mark, never
a colour on its own.`}}}},u=[{name:"Priya Natarajan",email:"priya@northwind.example",rsvp:"accepted",role:"organizer"},{name:"Marcus Webb",email:"marcus@northwind.example",rsvp:"accepted",role:"attendee"},{name:"Dana Okafor",email:"dana@northwind.example",rsvp:"tentative",role:"attendee"},{name:"Aisha Khan",email:"aisha@northwind.example",rsvp:"noReply",role:"attendee"},{name:"Sven Larsen",email:"sven@northwind.example",rsvp:"declined",role:"attendee"}],a={render:()=>e.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface p-3",children:e.jsx(m,{attendees:u})})},r={render:()=>{const[d,n]=v.useState("");return e.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface p-3",children:e.jsx(m,{attendees:u,activeEmail:d,onActivate:n,renderContext:t=>e.jsx("p",{className:"w-64 rounded-lg border border-line bg-surface-raised p-3 text-xs text-fg-muted",children:`Everything ${t.name} has written lately would go here.`})})})},play:async({canvasElement:d})=>{const n=h(d),t=n.getByRole("button",{name:/Aisha Khan/});await p.click(t);const c=await l(()=>n.getByText(/Everything Aisha Khan has written/));await i(t).toHaveAttribute("aria-expanded","true"),await i(t).toHaveAttribute("aria-controls",c.parentElement?.id),await p.click(c),await l(()=>i(c).toBeInTheDocument()),await i(t).toHaveAttribute("aria-expanded","true")}},o={render:()=>e.jsxs("div",{className:"flex gap-4",children:[e.jsx(s,{rsvp:"accepted"}),e.jsx(s,{rsvp:"tentative"}),e.jsx(s,{rsvp:"declined"}),e.jsx(s,{rsvp:"noReply"})]})};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-sm rounded-lg border border-line bg-surface p-3">
            <AttendeeList attendees={attendees} />
        </div>
}`,...a.parameters?.docs?.source},description:{story:"A full guest list, with the tally read off it rather than stated twice.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [active, setActive] = useState("");
    return <div className="max-w-sm rounded-lg border border-line bg-surface p-3">
                <AttendeeList attendees={attendees} activeEmail={active} onActivate={setActive} renderContext={attendee => <p className="w-64 rounded-lg border border-line bg-surface-raised p-3 text-xs text-fg-muted">
                            {\`Everything \${attendee.name} has written lately would go here.\`}
                        </p>} />
            </div>;
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const guest = canvas.getByRole("button", {
      name: /Aisha Khan/
    });
    await userEvent.click(guest);
    const opened = await waitFor(() => canvas.getByText(/Everything Aisha Khan has written/));
    await expect(guest).toHaveAttribute("aria-expanded", "true");
    await expect(guest).toHaveAttribute("aria-controls", opened.parentElement?.id);
    await userEvent.click(opened);
    await waitFor(() => expect(opened).toBeInTheDocument());
    await expect(guest).toHaveAttribute("aria-expanded", "true");
  }
}`,...r.parameters?.docs?.source},description:{story:`The same list where the surface has something to say about the person behind
a row. A row is then a disclosure: it opens under the guest, the same
activation closes it, and what opens is the caller's — the kit places it and
knows nothing else about it.`,...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex gap-4">
            <RsvpBadge rsvp="accepted" />
            <RsvpBadge rsvp="tentative" />
            <RsvpBadge rsvp="declined" />
            <RsvpBadge rsvp="noReply" />
        </div>
}`,...o.parameters?.docs?.source}}};const N=["List","WithContext","EveryReply"];export{o as EveryReply,a as List,r as WithContext,N as __namedExportsOrder,B as default};
