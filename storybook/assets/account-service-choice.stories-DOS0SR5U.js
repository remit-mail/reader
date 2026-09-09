import{j as e,r as u}from"./iframe-R-hq3KXP.js";import{A as d,a as g}from"./account-service-choice-oYwxiizY.js";import{B as b}from"./button-DALtMcT0.js";import"./preload-helper-PPVm8Dsz.js";import"./banner-BhQiwCh2.js";import"./cn-d2XQ1MEC.js";import"./x-Czc64qis.js";import"./createLucideIcon-BDKPi14T.js";import"./checkbox-kxQaUiyq.js";import"./check-DRXPT3gO.js";import"./minus-Blgn0-_O.js";const{expect:l,userEvent:h,within:v}=__STORYBOOK_MODULE_TEST__,T={title:"Components/AccountServiceChoice",component:d,parameters:{layout:"padded",docs:{description:{component:`What an account syncs, asked once before the provider redirect so the
consent screen matches the pick (#1178).`}}},decorators:[n=>e.jsx("div",{className:"mx-auto max-w-sm rounded-xl border border-line bg-surface p-4",children:e.jsx(n,{})})]},y=["Mail","Calendar"];function c({initial:n,offered:t=y}){const[p,x]=u.useState(n),[C,f]=u.useState(!1),m=p.length===0;return e.jsxs("div",{className:"space-y-3",children:[e.jsx(d,{providerName:"Microsoft",offered:t,selected:p,onChange:x,error:C&&m?g:void 0}),e.jsx(b,{variant:"primary",onClick:()=>f(m),children:"Continue"})]})}const a={render:()=>e.jsx(c,{initial:y})},r={render:()=>e.jsx(c,{initial:["Calendar"]})},o={render:()=>e.jsx(c,{initial:[]}),play:async({canvasElement:n})=>{const t=v(n);await l(t.queryByRole("alert")).toBeNull(),await h.click(t.getByRole("button",{name:"Continue"})),await l(t.getByRole("alert")).toHaveTextContent("Pick at least one")}},s={render:()=>e.jsxs(e.Fragment,{children:[e.jsx(d,{providerName:"Microsoft",offered:["Mail"],selected:["Mail"],onChange:()=>{}}),e.jsx("p",{className:"border-t border-line pt-2 text-2xs text-fg-subtle",children:"Nothing above this line: an IMAP account syncs mail and is not asked."})]})},i={render:()=>e.jsx(c,{initial:[],offered:["Mail"]}),play:async({canvasElement:n})=>{const t=v(n);await h.click(t.getByRole("button",{name:"Continue"})),await l(t.getByRole("alert")).toHaveTextContent("Pick at least one")}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <LiveChoice initial={bothServices} />
}`,...a.parameters?.docs?.source},description:{story:"A provider that syncs both. Both on is the default a host arrives with.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <LiveChoice initial={["Calendar"]} />
}`,...r.parameters?.docs?.source},description:{story:"Calendar only — the Outlook account kept for its calendar and nothing else.",...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <LiveChoice initial={[]} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("alert")).toBeNull();
    await userEvent.click(canvas.getByRole("button", {
      name: "Continue"
    }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Pick at least one");
  }
}`,...o.parameters?.docs?.source},description:{story:`Neither ticked. Continue says what is wrong instead of going quiet, and its
host refuses to submit the empty set.`,...o.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <>
            <AccountServiceChoice providerName="Microsoft" offered={["Mail"]} selected={["Mail"]} onChange={() => {}} />
            <p className="border-t border-line pt-2 text-2xs text-fg-subtle">
                Nothing above this line: an IMAP account syncs mail and is not asked.
            </p>
        </>
}`,...s.parameters?.docs?.source},description:{story:`A provider that only syncs mail. The rows are absent, not a disabled row —
the border below is the whole render.`,...s.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <LiveChoice initial={[]} offered={["Mail"]} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", {
      name: "Continue"
    }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Pick at least one");
  }
}`,...i.parameters?.docs?.source},description:{story:`One service on offer and none picked. There is nothing to tick, so the
refusal is the whole render — the host's Continue must not go quiet.`,...i.parameters?.docs?.description}}};const _=["BothServices","CalendarOnly","NeitherSelected","MailOnlyProvider","MailOnlyProviderRefused"];export{a as BothServices,r as CalendarOnly,s as MailOnlyProvider,i as MailOnlyProviderRefused,o as NeitherSelected,_ as __namedExportsOrder,T as default};
