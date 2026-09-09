import{j as e}from"./iframe-R-hq3KXP.js";import{A as n,a as o}from"./account-service-status-DghfJ5l6.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./badge-WI2U-Zts.js";import"./banner-BhQiwCh2.js";import"./button-DALtMcT0.js";import"./x-Czc64qis.js";import"./createLucideIcon-BDKPi14T.js";const{expect:c,within:l}=__STORYBOOK_MODULE_TEST__,g={title:"Components/AccountServiceStatus",parameters:{layout:"padded",docs:{description:{component:`How a switched-off service reads on the surfaces that hold what it left
behind (#1179): a label wherever the account is listed, and a notice over the
stored rows themselves.`}}}},a={render:()=>e.jsxs("div",{className:"flex flex-col items-start gap-2",children:[e.jsx(n,{service:"Mail"}),e.jsx(n,{service:"Calendar"})]})},r={render:()=>e.jsx(o,{service:"Mail",onEnable:()=>{}}),play:async({canvasElement:d})=>{const i=l(d);await c(i.getByText(/Everything already synced is here to read/)).toBeVisible(),await c(i.getByRole("button",{name:"Turn mail back on"})).toBeVisible()}},t={render:()=>e.jsx(o,{service:"Calendar",onEnable:()=>{}})},s={render:()=>e.jsx(o,{service:"Mail"})};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col items-start gap-2">
            <AccountServiceOffBadge service="Mail" />
            <AccountServiceOffBadge service="Calendar" />
        </div>
}`,...a.parameters?.docs?.source},description:{story:"The label an account carries in a list, a picker or the sidebar.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <AccountServiceOffNotice service="Mail" onEnable={() => undefined} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Everything already synced is here to read/)).toBeVisible();
    await expect(canvas.getByRole("button", {
      name: "Turn mail back on"
    })).toBeVisible();
  }
}`,...r.parameters?.docs?.source},description:{story:`Over a mail-disabled account's stored mailboxes. It says what is there before
it says what stopped — an empty-looking mailbox is the failure this exists to
prevent.`,...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <AccountServiceOffNotice service="Calendar" onEnable={() => undefined} />
}`,...t.parameters?.docs?.source},description:{story:"Over a paused provider calendar. Its events stay drawn on the grid.",...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <AccountServiceOffNotice service="Mail" />
}`,...s.parameters?.docs?.source},description:{story:"No way back on from here — the notice is a statement, never a dead button.",...s.parameters?.docs?.description}}};const w=["Badges","MailNotice","CalendarNotice","NoticeWithoutAction"];export{a as Badges,t as CalendarNotice,r as MailNotice,s as NoticeWithoutAction,w as __namedExportsOrder,g as default};
