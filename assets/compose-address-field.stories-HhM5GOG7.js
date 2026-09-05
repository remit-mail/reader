import{j as a,r}from"./iframe-uufGNBEn.js";import{C as k}from"./compose-address-field-CTJgKLwX.js";import"./preload-helper-PPVm8Dsz.js";import"./suggest-list-CAdYmTbd.js";import"./cn-d2XQ1MEC.js";import"./address-tag-CjFwgii3.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";const{expect:n,userEvent:s,waitFor:P,within:i}=__STORYBOOK_MODULE_TEST__,_=[{email:"ada@northwind.example",displayName:"Ada Lovelace"},{email:"grace@northwind.example",displayName:"Grace Hopper"},{email:"ops@northwind.example"}],Q={title:"Mail/ComposeAddressField",component:k,parameters:{layout:"padded",docs:{description:{component:`Recipients as chips, with a typeahead over the addresses the account already
knows. Nothing here fetches: the app hands the candidates in and is told what
has been typed, which is what makes the empty-result story below the same
component the app renders.`}}}},c=({initial:t=[],candidates:e=_,label:o="To"})=>{const[d,l]=r.useState(t),[p,R]=r.useState(""),B=e.filter(m=>`${m.displayName??""} ${m.email}`.toLowerCase().includes(p.toLowerCase()));return a.jsx("div",{className:"w-[520px]",children:a.jsx(k,{label:o,addresses:d,onChange:l,placeholder:"Recipients",suggestions:p.length>=2?B:[],onQueryChange:R})})},E={name:"Empty — the placeholder is the only content",render:()=>a.jsx(c,{})},S={render:()=>a.jsx(c,{initial:[{email:"ada@northwind.example",displayName:"Ada Lovelace"},{email:"ops@northwind.example"}]})},A={render:()=>a.jsx(c,{}),play:async({canvasElement:t})=>{const e=i(t).getByLabelText("To:");await s.type(e,"ada");const o=await i(t).findByRole("listbox");await n(i(o).getByText("Ada Lovelace")).toBeVisible(),await s.click(i(o).getByText("Ada Lovelace")),await n(i(t).getByText("Ada Lovelace")).toBeInTheDocument()}},u={render:()=>a.jsx(c,{candidates:[]}),play:async({canvasElement:t})=>{const e=i(t),o=e.getByLabelText("To:");await s.type(o,"someone@elsewhere.example{enter}"),await n(e.queryByRole("listbox")).not.toBeInTheDocument(),await n(e.getByText("someone@elsewhere.example")).toBeVisible()}},y={render:()=>a.jsx(c,{candidates:[]}),play:async({canvasElement:t})=>{const e=i(t).getByLabelText("To:");await s.type(e,"not-an-address{enter}"),await n(e).toHaveValue("not-an-address")}},V="Add a To address before sending.",D=t=>`To holds "${t}", which is not an address.`,g=({initial:t=[]})=>{const[e,o]=r.useState(t),[d,l]=r.useState({entries:[],unparsed:""}),[p,R]=r.useState(void 0),[B,m]=r.useState(void 0),H=r.useRef(null),C=(h,b)=>{if(h.trim())return D(h.trim());if(b===0)return V};return a.jsxs("div",{className:"w-[520px]",children:[a.jsx(k,{label:"To",addresses:e,onChange:o,placeholder:"Recipients",onPendingChange:l,ref:H}),a.jsx("button",{type:"button",onClick:()=>{const h=C(d.unparsed,e.length+d.entries.length);if(h!==void 0){m(h);return}const b=H.current?.commitPending(),N=b?.addresses??e,j=C(b?.unparsed??"",N.length);if(j!==void 0){m(j);return}R(N.map(q=>q.email))},children:"Send"}),p!==void 0&&a.jsx("p",{"data-testid":"sent-to",children:p.join(", ")}),B!==void 0&&a.jsx("p",{"data-testid":"refusal",children:B})]})},L={render:()=>a.jsx(g,{}),play:async({canvasElement:t})=>{const e=i(t);await s.type(e.getByLabelText("To:"),"typed@northwind.example"),await s.click(e.getByRole("button",{name:"Send"})),await n(e.getByTestId("sent-to")).toHaveTextContent("typed@northwind.example"),await n(e.queryByTestId("refusal")).not.toBeInTheDocument()}},w={render:()=>a.jsx(g,{}),play:async({canvasElement:t})=>{const e=i(t);await s.click(e.getByRole("button",{name:"Send"})),await n(e.getByTestId("refusal")).toHaveTextContent(V)}},f={render:()=>a.jsx(g,{initial:[{email:"chipped@northwind.example"}]}),play:async({canvasElement:t})=>{const e=i(t);await s.type(e.getByLabelText("To:"),"typed@northwind.example"),await s.click(e.getByRole("button",{name:"Send"})),await n(e.getByTestId("sent-to")).toHaveTextContent("chipped@northwind.example, typed@northwind.example")}},x={render:()=>a.jsx(g,{}),play:async({canvasElement:t})=>{const e=i(t);await s.click(e.getByLabelText("To:")),await s.paste("alice@northwind.example, bob@northwind.example"),await s.click(e.getByRole("button",{name:"Send"})),await n(e.getByTestId("sent-to")).toHaveTextContent("alice@northwind.example, bob@northwind.example")}},v={render:()=>a.jsx(g,{initial:[{email:"chipped@northwind.example"}]}),play:async({canvasElement:t})=>{const e=i(t),o=e.getByLabelText("To:");await s.type(o,"alice@northwind"),await s.click(e.getByRole("button",{name:"Send"})),await n(e.getByTestId("refusal")).toHaveTextContent(D("alice@northwind")),await n(e.queryByTestId("sent-to")).not.toBeInTheDocument(),await n(o).toHaveValue("alice@northwind")}},F=[{email:"beta@northwind.example",displayName:"Beta Team"},{email:"a@northwind.example.org",displayName:"Alpha Team"}],T={render:()=>a.jsx(c,{candidates:F}),play:async({canvasElement:t})=>{const e=i(t),o=e.getByLabelText("To:");await s.type(o,"a@northwind.example");const d=await e.findByRole("listbox");await s.click(i(d).getByText("Beta Team")),await n(e.getByText("Beta Team")).toBeVisible(),await n(o).toHaveValue(""),await new Promise(l=>setTimeout(l,400)),await n(e.getAllByRole("button",{name:/^Remove /})).toHaveLength(1),await n(e.queryByText("a@northwind.example")).not.toBeInTheDocument()}},I={render:()=>a.jsx(c,{initial:[{email:"ada@northwind.example",displayName:"Ada Lovelace"},{email:"ops@northwind.example"}]}),play:async({canvasElement:t})=>{const e=i(t),o=e.getByLabelText("To:");await s.click(o),await s.keyboard("{Backspace}"),await P(()=>n(e.queryByText("ops@northwind.example")).not.toBeInTheDocument()),await n(e.getByText("Ada Lovelace")).toBeVisible()}};E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  name: "Empty — the placeholder is the only content",
  render: () => <Harness />
}`,...E.parameters?.docs?.source}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initial={[{
    email: "ada@northwind.example",
    displayName: "Ada Lovelace"
  }, {
    email: "ops@northwind.example"
  }]} />
}`,...S.parameters?.docs?.source}}};A.parameters={...A.parameters,docs:{...A.parameters?.docs,source:{originalSource:`{
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
}`,...A.parameters?.docs?.source}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
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
}`,...u.parameters?.docs?.source},description:{story:`Nothing matches. The field stays a plain text field — an address the account
has never written to is still a valid address, and typing it out is the
normal case, not a failure.`,...u.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  render: () => <Harness candidates={[]} />,
  play: async ({
    canvasElement
  }) => {
    const input = within(canvasElement).getByLabelText<HTMLInputElement>("To:");
    await userEvent.type(input, "not-an-address{enter}");
    await expect(input).toHaveValue("not-an-address");
  }
}`,...y.parameters?.docs?.source},description:{story:"What is not an address stays in the field rather than becoming a chip.",...y.parameters?.docs?.description}}};L.parameters={...L.parameters,docs:{...L.parameters?.docs,source:{originalSource:`{
  render: () => <SendHarness />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("To:"), "typed@northwind.example");
    await userEvent.click(canvas.getByRole("button", {
      name: "Send"
    }));
    await expect(canvas.getByTestId("sent-to")).toHaveTextContent("typed@northwind.example");
    await expect(canvas.queryByTestId("refusal")).not.toBeInTheDocument();
  }
}`,...L.parameters?.docs?.source}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  render: () => <SendHarness />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", {
      name: "Send"
    }));
    await expect(canvas.getByTestId("refusal")).toHaveTextContent(NO_RECIPIENT_REFUSAL);
  }
}`,...w.parameters?.docs?.source},description:{story:"With nothing typed and no chip there is nothing to send to, and it says so.",...w.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  render: () => <SendHarness initial={[{
    email: "chipped@northwind.example"
  }]} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("To:"), "typed@northwind.example");
    await userEvent.click(canvas.getByRole("button", {
      name: "Send"
    }));
    await expect(canvas.getByTestId("sent-to")).toHaveTextContent("chipped@northwind.example, typed@northwind.example");
  }
}`,...f.parameters?.docs?.source}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <SendHarness />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText("To:"));
    await userEvent.paste("alice@northwind.example, bob@northwind.example");
    await userEvent.click(canvas.getByRole("button", {
      name: "Send"
    }));
    await expect(canvas.getByTestId("sent-to")).toHaveTextContent("alice@northwind.example, bob@northwind.example");
  }
}`,...x.parameters?.docs?.source},description:{story:"A pasted list arrives in one onChange and never sees the comma keydown.",...x.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  render: () => <SendHarness initial={[{
    email: "chipped@northwind.example"
  }]} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText<HTMLInputElement>("To:");
    await userEvent.type(input, "alice@northwind");
    await userEvent.click(canvas.getByRole("button", {
      name: "Send"
    }));
    await expect(canvas.getByTestId("refusal")).toHaveTextContent(notAnAddress("alice@northwind"));
    await expect(canvas.queryByTestId("sent-to")).not.toBeInTheDocument();
    await expect(input).toHaveValue("alice@northwind");
  }
}`,...v.parameters?.docs?.source},description:{story:`Text that is not an address stops the send and is quoted back. Going ahead
would deliver the message to everyone but the person that text was for, and
the composer closing on it would take the text away unread.`,...v.parameters?.docs?.description}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  render: () => <Harness candidates={NEARBY} />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText<HTMLInputElement>("To:");
    await userEvent.type(input, "a@northwind.example");
    const list = await canvas.findByRole("listbox");
    await userEvent.click(within(list).getByText("Beta Team"));
    await expect(canvas.getByText("Beta Team")).toBeVisible();
    await expect(input).toHaveValue("");

    // Past the blur timer, not merely past the click: the commit it scheduled
    // is cancelled, so the address that was typed never becomes a second chip.
    await new Promise(resolve => setTimeout(resolve, 400));
    await expect(canvas.getAllByRole("button", {
      name: /^Remove /
    })).toHaveLength(1);
    await expect(canvas.queryByText("a@northwind.example")).not.toBeInTheDocument();
  }
}`,...T.parameters?.docs?.source},description:{story:`The other press the field has to survive, and the reason the blur commit is
still on a timer: a click travelling towards a suggestion must not be answered
by the typed text becoming a chip and the list going with it.`,...T.parameters?.docs?.description}}};I.parameters={...I.parameters,docs:{...I.parameters?.docs,source:{originalSource:`{
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
}`,...I.parameters?.docs?.source}}};const z=["Empty","WithRecipients","SuggestionsOffered","NoMatches","IncompleteAddressIsNotTaken","SendTakesTheAddressStillInTheField","SendRefusesAnEmptyField","SendTakesTheAddressAfterAChip","SendTakesAPastedList","SendRefusesTextThatIsNotAnAddress","SuggestionSurvivesTheBlurItCauses","BackspaceRemovesTheLastChip"];export{I as BackspaceRemovesTheLastChip,E as Empty,y as IncompleteAddressIsNotTaken,u as NoMatches,w as SendRefusesAnEmptyField,v as SendRefusesTextThatIsNotAnAddress,x as SendTakesAPastedList,f as SendTakesTheAddressAfterAChip,L as SendTakesTheAddressStillInTheField,T as SuggestionSurvivesTheBlurItCauses,A as SuggestionsOffered,S as WithRecipients,z as __namedExportsOrder,Q as default};
