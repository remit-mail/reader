import{j as e}from"./iframe-fAVmrNjG.js";import{A as x}from"./attachment-list-CpOmtYGd.js";import{M as u}from"./message-body-view-BfMqULJe.js";import{R as m,C as p,E as g}from"./reading-pane-BQkouN7l.js";import{S as c}from"./star-DbXDvn6U.js";import{P as b}from"./paperclip-pIB-M0XR.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./loader-circle-tGqNKIei.js";import"./createLucideIcon-E7hVbHyY.js";import"./download-CqJNrf4f.js";import"./circle-alert-CLLSHsxA.js";import"./purify.es-2FREwzWT.js";import"./isolated-email-frame-DpOzHQ5H.js";import"./row-keyboard-4SpR8O0u.js";import"./avatar-CaxZOEiX.js";import"./button-C4vqyepI.js";import"./info-1t6AlOvJ.js";import"./reply-CvVUgHZ2.js";import"./trash-2-Dodc-R2m.js";import"./folder-input-CNYzPMSE.js";import"./kbd-BjH-iTj_.js";import"./inbox-wj8km1Ex.js";import"./chevron-right-Chf8xknM.js";import"./chevron-down-CV-Txd5h.js";import"./shield-alert-C2HtGUTP.js";const h={subject:"Q3 planning notes",messages:[{id:"msg-1",fromName:"Alex Rivera",fromEmail:"alex@example.com",toLabel:"you",dateLabel:"Yesterday, 14:02",snippet:"Here's where we landed after the call…",bodyHtml:"<p>Here's where we landed after the call. The roadmap stands.</p>"},{id:"msg-2",fromName:"Jamie Chen",fromEmail:"jamie@example.com",toLabel:"Alex Rivera, you",dateLabel:"Today, 09:11",snippet:"Thanks — I'll circulate the deck this afternoon.",bodyHtml:"<p>Thanks for the summary. I'll circulate the deck this afternoon and follow up with finance.</p><ul><li>Confirm headcount</li><li>Lock the budget</li></ul>",expanded:!0}]},f={subject:"Node Weekly — Issue 540",messages:[{id:"nl-1",fromName:"Node Weekly",fromEmail:"news@nodeweekly.example",toLabel:"you",dateLabel:"Today, 08:00",snippet:"Node.js 24 hits LTS, and more…",framed:!0,expanded:!0,bodyHtml:`<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
    <tr><td width="600" style="width:600px;background:#83cd29;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff;">
        <h1 style="margin:0;font-size:26px;">Node Weekly</h1>
        <p style="margin:4px 0 0;font-size:14px;">Issue 540</p>
    </td></tr>
    <tr><td width="600" style="width:600px;padding:24px;font-family:Georgia,serif;color:#1a1a1a;">
        <h2 style="font-size:18px;color:#111;">Node.js 24 hits LTS</h2>
        <p>The permission model graduated from experimental and the test runner picked up snapshot testing.</p>
        <p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
    </td></tr>
</table>`}]},J={title:"Screens/Kit/ReadingPane",component:m,parameters:{layout:"fullscreen"},render:a=>e.jsx("div",{className:"h-screen border border-line",children:e.jsx(m,{...a})})},i={args:{thread:h}},t={args:{thread:f}},l={args:{thread:void 0}},d={args:{thread:h,canToggleIntelligence:!0,intelligenceOpen:!1}},o={id:"row-1",fromName:"Jamie Chen",fromEmail:"jamie@example.com",toLabel:"Alex Rivera, you",dateLabel:"Today, 09:11",snippet:"Thanks — I'll circulate the deck this afternoon.",bodyHtml:"<p>Thanks for the summary. I'll circulate the deck this afternoon.</p>"},s={render:()=>e.jsxs("div",{className:"max-w-3xl border border-line",children:[e.jsx(p,{message:o,isUnread:!0,onClick:()=>alert("expand row-1"),trailing:e.jsxs("div",{className:"flex shrink-0 items-center gap-1",children:[e.jsx("button",{type:"button",onClick:a=>{a.stopPropagation(),alert("toggle star")},"aria-label":"Add star",className:"rounded p-0.5 text-fg-subtle hover:text-warning",children:e.jsx(c,{className:"size-3"})}),e.jsx("span",{className:"text-2xs text-fg-subtle tabular-nums",children:"Today, 09:11"})]})}),e.jsx(p,{message:{...o,id:"row-2",fromName:"Alex Rivera"},isFocused:!0,onClick:()=>alert("expand row-2"),trailing:e.jsxs("div",{className:"flex shrink-0 items-center gap-1",children:[e.jsx("button",{type:"button",onClick:a=>{a.stopPropagation(),alert("toggle star")},"aria-label":"Remove star",className:"rounded p-0.5 text-warning",children:e.jsx(c,{className:"size-3 fill-current"})}),e.jsx(b,{className:"size-3 text-fg-subtle",role:"img","aria-label":"Has an attachment"}),e.jsx("span",{className:"text-2xs text-fg-subtle tabular-nums",children:"Today, 08:42"})]})})]})},r={render:()=>e.jsx("div",{className:"max-w-3xl border border-line",children:e.jsx(g,{message:o,senderBadge:e.jsx("span",{className:"ml-1 text-positive text-xs",children:"✓"}),to:e.jsx(e.Fragment,{children:"to Alex Rivera and 2 others"}),indicators:e.jsx("div",{className:"mt-0.5 flex items-center gap-1",children:e.jsx(c,{className:"size-3.5 fill-current text-warning"})}),actionMenu:e.jsx("button",{type:"button",className:"rounded p-1 text-fg-subtle",children:"⋯"})})})},n={render:()=>e.jsx("div",{className:"max-w-3xl border border-line",children:e.jsx(g,{message:o,to:e.jsx(e.Fragment,{children:"to Alex Rivera and 2 others"}),indicators:e.jsx("div",{className:"mt-0.5 flex items-center gap-1",children:e.jsx(c,{className:"size-3.5 fill-current text-warning"})}),body:e.jsxs("div",{className:"mt-3",children:[e.jsx(u,{html:o.bodyHtml,category:"personal",allowImages:!0}),e.jsx(x,{className:"mt-4 px-2 lg:px-0",attachments:[{attachmentId:"part-2",filename:"Q3 board pack.pdf",typeLabel:"PDF",sizeOctets:2411724,download:{status:"idle"}},{attachmentId:"part-3",filename:"headcount.csv",typeLabel:"CSV",sizeOctets:4180,download:{status:"idle"}}],onDownload:a=>alert(`Download ${a}`)})]})})})};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    thread
  }
}`,...i.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    thread: newsletterThread
  }
}`,...t.parameters?.docs?.source},description:{story:`A designed newsletter rendered through the real sanitize → sandboxed-iframe
 pipeline — the same rendering the live app shows (#940).`,...t.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    thread: undefined
  }
}`,...l.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    thread,
    canToggleIntelligence: true,
    intelligenceOpen: false
  }
}`,...d.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-3xl border border-line">
            <CollapsedMessage message={row} isUnread onClick={() => alert("expand row-1")} trailing={<div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={e => {
        e.stopPropagation();
        alert("toggle star");
      }} aria-label="Add star" className="rounded p-0.5 text-fg-subtle hover:text-warning">
                            <Star className="size-3" />
                        </button>
                        <span className="text-2xs text-fg-subtle tabular-nums">
                            Today, 09:11
                        </span>
                    </div>} />
            <CollapsedMessage message={{
      ...row,
      id: "row-2",
      fromName: "Alex Rivera"
    }} isFocused onClick={() => alert("expand row-2")} trailing={<div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={e => {
        e.stopPropagation();
        alert("toggle star");
      }} aria-label="Remove star" className="rounded p-0.5 text-warning">
                            <Star className="size-3 fill-current" />
                        </button>
                        <Paperclip className="size-3 text-fg-subtle" role="img" aria-label="Has an attachment" />
                        <span className="text-2xs text-fg-subtle tabular-nums">
                            Today, 08:42
                        </span>
                    </div>} />
        </div>
}`,...s.parameters?.docs?.source},description:{story:'The collapsed row with the app\'s real trailing cluster (star + paperclip +\n date), an unread dot and a keyboard-focus ring — the slots the live\n MessageCard injects. The row is a `role="button"` div, so the interactive\n star in the trailing slot is a valid sibling control and not a `<button>`\n nested inside a `<button>` (#1232). Click the row to expand; the star stops\n propagation so it toggles without expanding.',...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-3xl border border-line">
            <ExpandedMessage message={row} senderBadge={<span className="ml-1 text-positive text-xs">✓</span>} to={<>to Alex Rivera and 2 others</>} indicators={<div className="mt-0.5 flex items-center gap-1">
                        <Star className="size-3.5 fill-current text-warning" />
                    </div>} actionMenu={<button type="button" className="rounded p-1 text-fg-subtle">
                        ⋯
                    </button>} />
        </div>
}`,...r.parameters?.docs?.source},description:{story:`The expanded row with the app's injected slots: a sender badge, an
 indicators row, an action-menu placeholder and a custom recipient line —
 proving the kit composes app interactivity without importing app code.`,...r.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-3xl border border-line">
            <ExpandedMessage message={row} to={<>to Alex Rivera and 2 others</>} indicators={<div className="mt-0.5 flex items-center gap-1">
                        <Star className="size-3.5 fill-current text-warning" />
                    </div>} body={<div className="mt-3">
                        <MessageBodyView html={row.bodyHtml} category="personal" allowImages />
                        <AttachmentList className="mt-4 px-2 lg:px-0" attachments={[{
        attachmentId: "part-2",
        filename: "Q3 board pack.pdf",
        typeLabel: "PDF",
        sizeOctets: 2_411_724,
        download: {
          status: "idle"
        }
      }, {
        attachmentId: "part-3",
        filename: "headcount.csv",
        typeLabel: "CSV",
        sizeOctets: 4_180,
        download: {
          status: "idle"
        }
      }]} onDownload={id => alert(\`Download \${id}\`)} />
                    </div>} />
        </div>
}`,...n.parameters?.docs?.source},description:{story:`The expanded row as \`MessageCard\` composes it when the message carries files
(#683): body first, attachment list under it. The indicators row holds no
paperclip — the list below is the affordance, and a second paperclip beside
the live star button only reads as a control that does nothing.`,...n.parameters?.docs?.description}}};const U=["WithThread","Newsletter","Empty","WithIntelligenceToggle","CollapsedRowComposed","ExpandedRowComposed","ExpandedRowWithAttachments"];export{s as CollapsedRowComposed,l as Empty,r as ExpandedRowComposed,n as ExpandedRowWithAttachments,t as Newsletter,d as WithIntelligenceToggle,i as WithThread,U as __namedExportsOrder,J as default};
