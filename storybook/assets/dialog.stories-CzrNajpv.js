import{j as e,r as m}from"./iframe-R-hq3KXP.js";import{B as r}from"./button-DALtMcT0.js";import{D as v}from"./dialog-DPsoMDN5.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./overlay-scope-CbgdyXI5.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-modal-focus-BNTAB0Hf.js";import"./dialog-backdrop-BIH6Z9bE.js";const{expect:t,userEvent:c,within:h}=__STORYBOOK_MODULE_TEST__,T={title:"Components/Dialog",component:v,parameters:{layout:"fullscreen"}};function b({initialOpen:o=!0}){const[a,n]=m.useState(o);return e.jsxs("div",{className:"h-dvh bg-canvas p-6",children:[e.jsx(r,{variant:"secondary",onClick:()=>n(!0),children:"Open dialog"}),e.jsx(v,{open:a,onClose:()=>n(!1),title:"Move message",children:e.jsxs("div",{className:"flex flex-col gap-3 p-4",children:[e.jsx("input",{"aria-label":"Folder",placeholder:"Folder",className:"h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg"}),e.jsxs("div",{className:"flex justify-end gap-2",children:[e.jsx(r,{variant:"ghost",onClick:()=>n(!1),children:"Cancel"}),e.jsx(r,{onClick:()=>n(!1),children:"Move"})]})]})})]})}const d={render:()=>e.jsx(b,{})},i={render:()=>e.jsx(b,{}),play:async({canvasElement:o})=>{const a=h(o),n=a.getByLabelText("Folder"),s=a.getByRole("button",{name:"Move"}),u=a.getByRole("button",{name:"Open dialog"});await t(n).toHaveFocus(),await c.tab(),await t(a.getByRole("button",{name:"Cancel"})).toHaveFocus(),await c.tab(),await t(s).toHaveFocus(),await c.tab(),await t(n).toHaveFocus(),await t(u).not.toHaveFocus(),await c.tab({shift:!0}),await t(s).toHaveFocus(),await t(u).not.toHaveFocus()}},l={render:()=>e.jsx(b,{initialOpen:!1}),play:async({canvasElement:o})=>{const a=h(o),n=a.getByRole("button",{name:"Open dialog"});await c.click(n),await t(a.getByLabelText("Folder")).toHaveFocus(),await c.keyboard("{Escape}"),await t(a.queryByRole("dialog")).toBeNull(),await t(n).toHaveFocus()}};function x(){const[o,a]=m.useState(!0),[n,s]=m.useState(!0);return e.jsxs("div",{className:"h-dvh bg-canvas p-6",children:[e.jsx(v,{open:o,onClose:()=>a(!1),title:"Folders",anchor:"left",children:e.jsxs("nav",{className:"flex flex-col gap-2 p-4",children:[e.jsx(r,{variant:"ghost",children:"Inbox"}),e.jsx(r,{variant:"ghost",children:"Archive"})]})}),e.jsx(v,{open:n,onClose:()=>s(!1),title:"Move message",children:e.jsxs("div",{className:"flex justify-end gap-2 p-4",children:[e.jsx(r,{variant:"ghost",onClick:()=>s(!1),children:"Cancel"}),e.jsx(r,{onClick:()=>s(!1),children:"Move"})]})})]})}const p={render:()=>e.jsx(x,{}),play:async({canvasElement:o})=>{const a=h(o),n=a.getByRole("button",{name:"Cancel"}),s=a.getByRole("button",{name:"Move"}),u=a.getByRole("button",{name:"Inbox"}),w=a.getByRole("button",{name:"Archive"});await t(n).toHaveFocus(),await c.tab(),await t(s).toHaveFocus(),await c.tab(),await t(n).toHaveFocus(),await t(u).not.toHaveFocus(),await t(w).not.toHaveFocus(),await c.tab({shift:!0}),await t(s).toHaveFocus(),await t(w).not.toHaveFocus()}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Demo />
}`,...d.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Demo />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByLabelText("Folder");
    const last = canvas.getByRole("button", {
      name: "Move"
    });
    const opener = canvas.getByRole("button", {
      name: "Open dialog"
    });
    await expect(first).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", {
      name: "Cancel"
    })).toHaveFocus();
    await userEvent.tab();
    await expect(last).toHaveFocus();
    await userEvent.tab();
    await expect(first).toHaveFocus();
    await expect(opener).not.toHaveFocus();
    await userEvent.tab({
      shift: true
    });
    await expect(last).toHaveFocus();
    await expect(opener).not.toHaveFocus();
  }
}`,...i.parameters?.docs?.source},description:{story:`The dialog claims \`aria-modal\`, so the page behind it is hidden from a screen
reader and the keyboard has to agree: focus opens on the first control, Tab
off the last wraps to the first, Shift+Tab off the first wraps to the last,
and neither reaches the button behind the scrim.`,...i.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Demo initialOpen={false} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const opener = canvas.getByRole("button", {
      name: "Open dialog"
    });
    await userEvent.click(opener);
    await expect(canvas.getByLabelText("Folder")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(opener).toHaveFocus();
  }
}`,...l.parameters?.docs?.source},description:{story:`Escape dismisses the dialog and hands focus back to whatever opened it, so a
keyboard user is never left parked on a surface that has gone.`,...l.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <StackedDemo />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const cancel = canvas.getByRole("button", {
      name: "Cancel"
    });
    const move = canvas.getByRole("button", {
      name: "Move"
    });
    const inbox = canvas.getByRole("button", {
      name: "Inbox"
    });
    const archive = canvas.getByRole("button", {
      name: "Archive"
    });
    await expect(cancel).toHaveFocus();
    await userEvent.tab();
    await expect(move).toHaveFocus();
    await userEvent.tab();
    await expect(cancel).toHaveFocus();
    await expect(inbox).not.toHaveFocus();
    await expect(archive).not.toHaveFocus();
    await userEvent.tab({
      shift: true
    });
    await expect(move).toHaveFocus();
    await expect(archive).not.toHaveFocus();
  }
}`,...p.parameters?.docs?.source},description:{story:"At narrow widths the nav drawer is a dialog too, so two `aria-modal` surfaces\ncan be up at once. Tab belongs to the one on top: it cycles between Cancel and\nMove and never reaches the folder list behind it (#1204).",...p.parameters?.docs?.description}}};const O=["Default","TrapsTabAtBothEdges","EscapeReturnsFocus","TabStaysInTheTopSurface"];export{d as Default,l as EscapeReturnsFocus,p as TabStaysInTheTopSurface,i as TrapsTabAtBothEdges,O as __namedExportsOrder,T as default};
