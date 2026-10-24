import{j as a}from"./iframe-DS5xN_9u.js";import{A as p}from"./account-menu-BiiMsene.js";import"./preload-helper-PPVm8Dsz.js";import"./avatar-0XeRnqKm.js";import"./cn-d2XQ1MEC.js";import"./popover-menu-Ca1AfHoA.js";import"./index-CZzkLRAv.js";import"./index-IJTHyTL_.js";import"./overlay-scope-BDkw0-iB.js";import"./keymap-dispatch-DTaqnLKC.js";import"./button-D5VdN6KM.js";import"./createLucideIcon-C2HcSaX7.js";const{expect:t,fn:b,userEvent:o,waitFor:y,within:r}=__STORYBOOK_MODULE_TEST__,w="info@example.com",F={title:"Design System/Auth/AccountMenu",component:p,parameters:{layout:"padded"},args:{email:w,onSignOut:()=>{}},render:e=>a.jsx("div",{className:"flex h-48 justify-end p-4",children:a.jsx(p,{...e})})},c={},i={play:async({canvasElement:e})=>{const s=r(e);await o.click(s.getByRole("button",{name:"Account"}));const n=r(e.ownerDocument.body);await t(n.getByTestId("account-menu-email")).toHaveTextContent(w),await t(n.getByRole("menuitem",{name:"Sign out"})).toBeVisible()}},u={args:{email:null},play:async({canvasElement:e})=>{const s=r(e);await o.click(s.getByRole("button",{name:"Account"}));const n=r(e.ownerDocument.body);await t(n.queryByTestId("account-menu-email")).toBeNull(),await t(n.getByRole("menuitem",{name:"Sign out"})).toBeVisible()}},m={args:{onSignOut:b()},render:e=>a.jsxs("div",{className:"flex h-48 items-start justify-end gap-2 p-4",children:[a.jsx(p,{...e}),a.jsx("button",{type:"button",children:"After the menu"})]}),play:async({args:e,canvasElement:s})=>{const n=r(s),g=r(s.ownerDocument.body),d=n.getByRole("button",{name:"Account"});await o.tab(),await t(d).toHaveFocus(),await o.keyboard("{Enter}");const v=await g.findByRole("menuitem",{name:"Sign out"});await y(()=>t(v).toHaveFocus()),await o.keyboard("{Escape}"),await t(g.queryByRole("menuitem")).toBeNull(),await t(d).toHaveFocus(),await o.keyboard("{Enter}"),await y(()=>t(g.getByRole("menuitem",{name:"Sign out"})).toHaveFocus()),await o.keyboard("{Enter}"),await t(e.onSignOut).toHaveBeenCalledOnce(),await t(d).toHaveFocus()}},l={render:e=>a.jsxs("header",{className:"flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3",children:[a.jsx("div",{className:"flex-1"}),a.jsx(p,{...e})]})};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:"{}",...c.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", {
      name: "Account"
    }));
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByTestId("account-menu-email")).toHaveTextContent(EMAIL);
    await expect(page.getByRole("menuitem", {
      name: "Sign out"
    })).toBeVisible();
  }
}`,...i.parameters?.docs?.source}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    email: null
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", {
      name: "Account"
    }));
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.queryByTestId("account-menu-email")).toBeNull();
    await expect(page.getByRole("menuitem", {
      name: "Sign out"
    })).toBeVisible();
  }
}`,...u.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: {
    onSignOut: fn()
  },
  render: args => <div className="flex h-48 items-start justify-end gap-2 p-4">
            <AccountMenu {...args} />
            <button type="button">After the menu</button>
        </div>,
  play: async ({
    args,
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", {
      name: "Account"
    });
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const signOut = await page.findByRole("menuitem", {
      name: "Sign out"
    });
    await waitFor(() => expect(signOut).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await expect(page.queryByRole("menuitem")).toBeNull();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(page.getByRole("menuitem", {
      name: "Sign out"
    })).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(args.onSignOut).toHaveBeenCalledOnce();
    await expect(trigger).toHaveFocus();
  }
}`,...m.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: args => <header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
            <div className="flex-1" />
            <AccountMenu {...args} />
        </header>
}`,...l.parameters?.docs?.source}}};const N=["Closed","Open","NoEmail","KeyboardReachesSignOut","InTopBar"];export{c as Closed,l as InTopBar,m as KeyboardReachesSignOut,u as NoEmail,i as Open,N as __namedExportsOrder,F as default};
