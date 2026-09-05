import{r as y,j as l}from"./iframe-uufGNBEn.js";import{C as v}from"./compose-action-bar-BqRSIUsF.js";import"./preload-helper-PPVm8Dsz.js";import"./button-Wi0n0Lyz.js";import"./cn-d2XQ1MEC.js";import"./loader-circle-qkSTSuP1.js";import"./createLucideIcon-Bn-Stmx4.js";import"./send-Auw0BsZV.js";import"./trash-2-RI1RlAl9.js";const{expect:u,fn:m,userEvent:S,within:h}=__STORYBOOK_MODULE_TEST__,C={title:"Mail/ComposeActionBar",component:v,parameters:{layout:"padded",docs:{description:{component:`Send, Discard, and what the draft is doing. Send is never greyed out and
never silent: a state that cannot send carries the sentence that says why,
and the press reports it.`}}},args:{send:{status:"ready"},onSend:m(),onBlocked:m(),onDiscard:m(),save:{status:"idle"}}},o={},r={args:{save:{status:"saving"}}},d={args:{save:{status:"saved"}}},c={args:{save:{status:"error"}}},s={name:"Unsaved — the draft has no To address yet",args:{send:{status:"blocked",reason:"Add a To address before sending."},save:{status:"unsaved",reason:"Not saved — add a To address to keep this draft."}},play:async({canvasElement:e})=>{const a=h(e);await u(a.getByRole("status")).toHaveTextContent("Not saved — add a To address to keep this draft.")}},i={name:"Sending — also while the pending draft is written",args:{send:{status:"sending"}}},n={name:"Blocked — nobody to send to",args:{send:{status:"blocked",reason:"Add a To address before sending."}},render:e=>{const[a,t]=y.useState();return l.jsxs("div",{className:"space-y-2",children:[a&&l.jsx("div",{role:"alert","data-testid":"compose-unavailable",className:"rounded-md bg-danger-soft px-3 py-2 text-sm text-danger",children:a}),l.jsx(v,{...e,onBlocked:g=>{e.onBlocked(g),t(g)}})]})},play:async({args:e,canvasElement:a})=>{const t=h(a);await S.click(t.getByRole("button",{name:"Send"})),await u(t.getByTestId("compose-unavailable")).toHaveTextContent("Add a To address before sending."),await u(e.onSend).not.toHaveBeenCalled()}},p={name:"Blocked — the account cannot send",args:{send:{status:"blocked",reason:"This account can't send mail until SMTP is configured."}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:"{}",...o.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    save: {
      status: "saving"
    }
  }
}`,...r.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    save: {
      status: "saved"
    }
  }
}`,...d.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    save: {
      status: "error"
    }
  }
}`,...c.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Unsaved — the draft has no To address yet",
  args: {
    send: {
      status: "blocked",
      reason: "Add a To address before sending."
    },
    save: {
      status: "unsaved",
      reason: "Not saved — add a To address to keep this draft."
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Not saved — add a To address to keep this draft.");
  }
}`,...s.parameters?.docs?.source},description:{story:`Nothing has been written to the server yet and nothing will be until the
draft has a To address to be created against. Silence here was the worst of
both: the text was not being kept, and the composer looked exactly like one
that had nothing to keep. The sentence names To rather than "a recipient",
which a message addressed only in Cc already has.`,...s.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Sending — also while the pending draft is written",
  args: {
    send: {
      status: "sending"
    }
  }
}`,...i.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Blocked — nobody to send to",
  args: {
    send: {
      status: "blocked",
      reason: "Add a To address before sending."
    }
  },
  render: args => {
    const [reason, setReason] = useState<string>();
    return <div className="space-y-2">
                {reason && <div role="alert" data-testid="compose-unavailable" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                        {reason}
                    </div>}
                <ComposeActionBar {...args} onBlocked={next => {
        args.onBlocked(next);
        setReason(next);
      }} />
            </div>;
  },
  play: async ({
    args,
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", {
      name: "Send"
    }));
    await expect(canvas.getByTestId("compose-unavailable")).toHaveTextContent("Add a To address before sending.");
    await expect(args.onSend).not.toHaveBeenCalled();
  }
}`,...n.parameters?.docs?.source},description:{story:`Send is never greyed out. Pressing it with nobody to send to reports the
reason where the app would raise its banner — a control that swallowed the
press would be the dead button this bar exists to avoid.`,...n.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "Blocked — the account cannot send",
  args: {
    send: {
      status: "blocked",
      reason: "This account can't send mail until SMTP is configured."
    }
  }
}`,...p.parameters?.docs?.source}}};const E=["Ready","Saving","Saved","SaveFailed","NotSavedYet","Sending","NoRecipient","SmtpMissing"];export{n as NoRecipient,s as NotSavedYet,o as Ready,c as SaveFailed,d as Saved,r as Saving,i as Sending,p as SmtpMissing,E as __namedExportsOrder,C as default};
