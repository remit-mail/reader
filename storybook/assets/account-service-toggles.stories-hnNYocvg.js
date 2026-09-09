import{j as e}from"./iframe-R-hq3KXP.js";import{b as u}from"./account-service-status-DghfJ5l6.js";import{A as m}from"./account-service-toggles-B9qeomfY.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./badge-WI2U-Zts.js";import"./banner-BhQiwCh2.js";import"./button-DALtMcT0.js";import"./x-Czc64qis.js";import"./createLucideIcon-BDKPi14T.js";import"./account-service-choice-oYwxiizY.js";import"./checkbox-kxQaUiyq.js";import"./check-DRXPT3gO.js";import"./minus-Blgn0-_O.js";const{expect:p,userEvent:v,within:h}=__STORYBOOK_MODULE_TEST__,N={title:"Components/AccountServiceToggles",component:m,parameters:{layout:"padded",docs:{description:{component:`What an account syncs, on its settings screen (#1179). The switch asks; the
host confirms and commits.`}}},decorators:[s=>e.jsx("div",{className:"mx-auto max-w-sm rounded-xl border border-line bg-surface p-4",children:e.jsx(s,{})})]},d=["Mail","Calendar"];function l({enabled:s,consented:i=d,offered:c=d,onRequestChange:g=()=>{}}){return e.jsx(m,{providerName:"Microsoft",offered:c,enabled:s,consented:i,onRequestChange:g})}const n={render:()=>e.jsx(l,{enabled:d})},t={render:()=>e.jsx(l,{enabled:["Calendar"]})},a={render:()=>e.jsx(l,{enabled:["Mail"],consented:["Mail"]}),play:async({canvasElement:s})=>{const i=h(s);await p(i.getByText(/signing in with Microsoft again/)).toBeVisible()}},r={render:()=>e.jsx(l,{enabled:d}),play:async({canvasElement:s})=>{const c=h(s).getByRole("switch",{name:"Sync mail"});await v.click(c),await p(c).toBeChecked()}},o={render:()=>e.jsxs(e.Fragment,{children:[e.jsx(m,{providerName:"Fastmail",offered:["Mail"],enabled:["Mail"],consented:["Mail"],onRequestChange:()=>{}}),e.jsx("p",{className:"border-t border-line pt-2 text-2xs text-fg-subtle",children:u})]})};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Toggles enabled={bothServices} />
}`,...n.parameters?.docs?.source},description:{story:"Both services on: the state an Outlook account arrives in from onboarding.",...n.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Toggles enabled={["Calendar"]} />
}`,...t.parameters?.docs?.source},description:{story:`Mail off. The switch is the only thing that changed — the account keeps its
place and its stored mail, which the other surfaces say for themselves.`,...t.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Toggles enabled={["Mail"]} consented={["Mail"]} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/signing in with Microsoft again/)).toBeVisible();
  }
}`,...a.parameters?.docs?.source},description:{story:`Calendar was never consented to. The row says what turning it on costs before
it is pressed, because no saved setting can grant a scope.`,...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Toggles enabled={bothServices} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const mail = canvas.getByRole("switch", {
      name: "Sync mail"
    });
    await userEvent.click(mail);
    await expect(mail).toBeChecked();
  }
}`,...r.parameters?.docs?.source},description:{story:`Pressing a running service asks to switch it off. Nothing moves on screen:
the host raises the confirmation and owns the change.`,...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <>
            <AccountServiceToggles providerName="Fastmail" offered={["Mail"]} enabled={["Mail"]} consented={["Mail"]} onRequestChange={() => {}} />
            <p className="border-t border-line pt-2 text-2xs text-fg-subtle">
                {ACCOUNT_NO_SERVICE_TOGGLES_MESSAGE}
            </p>
        </>
}`,...o.parameters?.docs?.source},description:{story:`An IMAP account. It syncs mail and nothing else, so there is nothing to
switch — the border below is the whole render.`,...o.parameters?.docs?.description}}};const j=["BothOn","MailOff","CalendarNeedsConsent","AsksBeforeItMoves","ImapAccount"];export{r as AsksBeforeItMoves,n as BothOn,a as CalendarNeedsConsent,o as ImapAccount,t as MailOff,j as __namedExportsOrder,N as default};
