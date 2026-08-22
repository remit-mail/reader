import{j as s,r as w}from"./iframe-BxLfZl0d.js";import{C as x}from"./compose-address-field-BRnXbcUj.js";import"./preload-helper-PPVm8Dsz.js";import"./suggest-list-BMzgWPLj.js";import"./cn-d2XQ1MEC.js";import"./address-tag-BKpYEEBZ.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";const{expect:o,userEvent:i,waitFor:L,within:n}=__STORYBOOK_MODULE_TEST__,E=[{email:"ada@northwind.example",displayName:"Ada Lovelace"},{email:"grace@northwind.example",displayName:"Grace Hopper"},{email:"ops@northwind.example"}],I={title:"Mail/ComposeAddressField",component:x,parameters:{layout:"padded",docs:{description:{component:`Recipients as chips, with a typeahead over the addresses the account already
knows. Nothing here fetches: the app hands the candidates in and is told what
has been typed, which is what makes the empty-result story below the same
component the app renders.`}}}},r=({initial:a=[],candidates:e=E,label:t="To"})=>{const[v,T]=w.useState(a),[y,B]=w.useState(""),g=e.filter(u=>`${u.displayName??""} ${u.email}`.toLowerCase().includes(y.toLowerCase()));return s.jsx("div",{className:"w-[520px]",children:s.jsx(x,{label:t,addresses:v,onChange:T,placeholder:"Recipients",suggestions:y.length>=2?g:[],onQueryChange:B})})},d={name:"Empty — the placeholder is the only content",render:()=>s.jsx(r,{})},l={render:()=>s.jsx(r,{initial:[{email:"ada@northwind.example",displayName:"Ada Lovelace"},{email:"ops@northwind.example"}]})},m={render:()=>s.jsx(r,{}),play:async({canvasElement:a})=>{const e=n(a).getByLabelText("To:");await i.type(e,"ada");const t=await n(a).findByRole("listbox");await o(n(t).getByText("Ada Lovelace")).toBeVisible(),await i.click(n(t).getByText("Ada Lovelace")),await o(n(a).getByText("Ada Lovelace")).toBeInTheDocument()}},c={render:()=>s.jsx(r,{candidates:[]}),play:async({canvasElement:a})=>{const e=n(a),t=e.getByLabelText("To:");await i.type(t,"someone@elsewhere.example{enter}"),await o(e.queryByRole("listbox")).not.toBeInTheDocument(),await o(e.getByText("someone@elsewhere.example")).toBeVisible()}},p={render:()=>s.jsx(r,{candidates:[]}),play:async({canvasElement:a})=>{const e=n(a).getByLabelText("To:");await i.type(e,"not-an-address{enter}"),await o(e).toHaveValue("not-an-address")}},h={render:()=>s.jsx(r,{initial:[{email:"ada@northwind.example",displayName:"Ada Lovelace"},{email:"ops@northwind.example"}]}),play:async({canvasElement:a})=>{const e=n(a),t=e.getByLabelText("To:");await i.click(t),await i.keyboard("{Backspace}"),await L(()=>o(e.queryByText("ops@northwind.example")).not.toBeInTheDocument()),await o(e.getByText("Ada Lovelace")).toBeVisible()}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "Empty — the placeholder is the only content",
  render: () => <Harness />
}`,...d.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initial={[{
    email: "ada@northwind.example",
    displayName: "Ada Lovelace"
  }, {
    email: "ops@northwind.example"
  }]} />
}`,...l.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <Harness />,
  play: async ({
    canvasElement
  }) => {
    const input = within(canvasElement).getByLabelText("To:");
    await userEvent.type(input, "ada");
    const list = await within(canvasElement).findByRole("listbox");
    await expect(within(list).getByText("Ada Lovelace")).toBeVisible();
    await userEvent.click(within(list).getByText("Ada Lovelace"));
    await expect(within(canvasElement).getByText("Ada Lovelace")).toBeInTheDocument();
  }
}`,...m.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <Harness candidates={[]} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("To:");
    await userEvent.type(input, "someone@elsewhere.example{enter}");
    await expect(canvas.queryByRole("listbox")).not.toBeInTheDocument();
    await expect(canvas.getByText("someone@elsewhere.example")).toBeVisible();
  }
}`,...c.parameters?.docs?.source},description:{story:`Nothing matches. The field stays a plain text field — an address the account
has never written to is still a valid address, and typing it out is the
normal case, not a failure.`,...c.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <Harness candidates={[]} />,
  play: async ({
    canvasElement
  }) => {
    const input = within(canvasElement).getByLabelText<HTMLInputElement>("To:");
    await userEvent.type(input, "not-an-address{enter}");
    await expect(input).toHaveValue("not-an-address");
  }
}`,...p.parameters?.docs?.source},description:{story:"What is not an address stays in the field rather than becoming a chip.",...p.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initial={[{
    email: "ada@northwind.example",
    displayName: "Ada Lovelace"
  }, {
    email: "ops@northwind.example"
  }]} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("To:");
    await userEvent.click(input);
    await userEvent.keyboard("{Backspace}");
    await waitFor(() => expect(canvas.queryByText("ops@northwind.example")).not.toBeInTheDocument());
    await expect(canvas.getByText("Ada Lovelace")).toBeVisible();
  }
}`,...h.parameters?.docs?.source}}};const j=["Empty","WithRecipients","SuggestionsOffered","NoMatches","IncompleteAddressIsNotTaken","BackspaceRemovesTheLastChip"];export{h as BackspaceRemovesTheLastChip,d as Empty,p as IncompleteAddressIsNotTaken,c as NoMatches,m as SuggestionsOffered,l as WithRecipients,j as __namedExportsOrder,I as default};
