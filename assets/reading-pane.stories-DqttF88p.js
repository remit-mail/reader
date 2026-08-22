import{j as e,r as E}from"./iframe-BxLfZl0d.js";import{A as H}from"./attachment-list-Curyi-58.js";import{R as S,C as j,E as o,M as C}from"./reading-pane-Bg7DCBEV.js";import{S as N}from"./star-BnMPyPKH.js";import{P}from"./paperclip-BuRqVWrf.js";import"./preload-helper-PPVm8Dsz.js";import"./attachment-file-qTo3Y5Tj.js";import"./cn-d2XQ1MEC.js";import"./loader-circle-tcZ5ujJC.js";import"./createLucideIcon-DDkWk8mg.js";import"./download-BDc64jbo.js";import"./circle-alert-dyRtukXU.js";import"./row-keyboard-4SpR8O0u.js";import"./avatar-B9NbFnlE.js";import"./button-y3nctzTP.js";import"./info-DzxrBM2t.js";import"./reply-pGfOTtuM.js";import"./trash-2-DGdeO5MV.js";import"./folder-input-DJySXBqv.js";import"./purify.es-P3vI1IgJ.js";import"./isolated-email-frame-CiQ5nqLR.js";import"./kbd-DVhAck-o.js";import"./inbox-DwY9RJbq.js";import"./chevron-down-DBsC1ZFK.js";import"./shield-alert-Beo-XT4k.js";import"./chevron-right-C4q9meQG.js";const{expect:R}=__STORYBOOK_MODULE_TEST__,M={subject:"Q3 planning notes",messages:[{id:"msg-1",fromName:"Alex Rivera",fromEmail:"alex@example.com",toLabel:"you",dateLabel:"Yesterday, 14:02",snippet:"Here's where we landed after the call…",bodyHtml:"<p>Here's where we landed after the call. The roadmap stands.</p>"},{id:"msg-2",fromName:"Jamie Chen",fromEmail:"jamie@example.com",toLabel:"Alex Rivera, you",dateLabel:"Today, 09:11",snippet:"Thanks — I'll circulate the deck this afternoon.",bodyHtml:"<p>Thanks for the summary. I'll circulate the deck this afternoon and follow up with finance.</p><ul><li>Confirm headcount</li><li>Lock the budget</li></ul>",expanded:!0}]},T={subject:"Node Weekly — Issue 540",messages:[{id:"nl-1",fromName:"Node Weekly",fromEmail:"news@nodeweekly.example",toLabel:"you",dateLabel:"Today, 08:00",snippet:"Node.js 24 hits LTS, and more…",framed:!0,expanded:!0,bodyHtml:`<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
    <tr><td width="600" style="width:600px;background:#83cd29;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff;">
        <h1 style="margin:0;font-size:26px;">Node Weekly</h1>
        <p style="margin:4px 0 0;font-size:14px;">Issue 540</p>
    </td></tr>
    <tr><td width="600" style="width:600px;padding:24px;font-family:Georgia,serif;color:#1a1a1a;">
        <h2 style="font-size:18px;color:#111;">Node.js 24 hits LTS</h2>
        <p>The permission model graduated from experimental and the test runner picked up snapshot testing.</p>
        <p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
    </td></tr>
</table>`}]},A={subject:"Repetitie donderdag",messages:[{id:"bare-1",fromName:"Ingrid Bakker",fromEmail:"ingrid@koor.example",toLabel:"you",dateLabel:"Today, 11:24",snippet:"De repetitie van donderdag gaat door…",expanded:!0,bodyHtml:`<div>
    <p>Hoi allemaal,</p>
    <p>De repetitie van donderdag gaat door. We beginnen met het nieuwe stuk en
    repeteren om 20.00 uur verder aan het programma voor het najaarsconcert.</p>
    <p><b>Neem je eigen partituur mee</b> — er zijn geen reservekopie&euml;n.</p>
    <p>Groeten,<br>Ingrid</p>
</div>`}]},z=`Hoi allemaal,

De repetitie van donderdag gaat door. We beginnen met het nieuwe stuk en
repeteren om 20.00 uur verder aan het programma voor het najaarsconcert.

Groeten,
Ingrid`,pe={title:"Screens/Kit/ReadingPane",component:S,parameters:{layout:"fullscreen"},render:a=>e.jsx("div",{className:"h-screen border border-line",children:e.jsx(S,{...a})})},f={args:{thread:M}},i={args:{thread:T}},d={args:{thread:T},parameters:{theme:"dark"}},l={args:{thread:A}},c={args:{thread:A},parameters:{theme:"dark"}},y={args:{thread:void 0}},v={args:{thread:M,canToggleIntelligence:!0,intelligenceOpen:!1}},r={id:"row-1",fromName:"Jamie Chen",fromEmail:"jamie@example.com",toLabel:"Alex Rivera, you",dateLabel:"Today, 09:11",snippet:"Thanks — I'll circulate the deck this afternoon.",bodyHtml:"<p>Thanks for the summary. I'll circulate the deck this afternoon.</p>"},m={render:()=>e.jsxs("div",{className:"max-w-3xl border border-line",children:[e.jsx(j,{message:r,isUnread:!0,onClick:()=>alert("expand row-1"),trailing:e.jsxs("div",{className:"flex shrink-0 items-center gap-1",children:[e.jsx("button",{type:"button",onClick:a=>{a.stopPropagation(),alert("toggle star")},"aria-label":"Add star",className:"rounded p-0.5 text-fg-subtle hover:text-warning",children:e.jsx(N,{className:"size-3"})}),e.jsx("span",{className:"text-2xs text-fg-subtle tabular-nums",children:"Today, 09:11"})]})}),e.jsx(j,{message:{...r,id:"row-2",fromName:"Alex Rivera"},isFocused:!0,onClick:()=>alert("expand row-2"),trailing:e.jsxs("div",{className:"flex shrink-0 items-center gap-1",children:[e.jsx("button",{type:"button",onClick:a=>{a.stopPropagation(),alert("toggle star")},"aria-label":"Remove star",className:"rounded p-0.5 text-warning",children:e.jsx(N,{className:"size-3 fill-current"})}),e.jsx(P,{className:"size-3 text-fg-subtle",role:"img","aria-label":"Has an attachment"}),e.jsx("span",{className:"text-2xs text-fg-subtle tabular-nums",children:"Today, 08:42"})]})})]})},p={render:()=>e.jsx("div",{className:"max-w-3xl border border-line",children:e.jsx(o,{message:r,senderBadge:e.jsx("span",{className:"ml-1 text-positive text-xs",children:"✓"}),to:e.jsx(e.Fragment,{children:"to Alex Rivera and 2 others"}),indicators:e.jsx("div",{className:"mt-0.5 flex items-center gap-1",children:e.jsx(N,{className:"size-3.5 fill-current text-warning"})}),actionMenu:e.jsx("button",{type:"button",className:"rounded p-1 text-fg-subtle",children:"⋯"})})})},g={render:function(){const[t,s]=E.useState(!0);return e.jsx("div",{className:"max-w-3xl border border-line",children:t?e.jsx(o,{message:r,onHeaderClick:()=>s(!1)}):e.jsx(j,{message:r,onClick:()=>s(!0)})})}},D=()=>{const[a,t]=E.useState([{attachmentId:"part-2",filename:"Q3 board pack.pdf",typeLabel:"PDF",sizeOctets:2411724,download:{status:"idle"}},{attachmentId:"part-3",filename:"headcount.csv",typeLabel:"CSV",sizeOctets:4180,download:{status:"idle"}}]),s=(n,w)=>t(L=>L.map(k=>k.attachmentId===n?{...k,download:w}:k));return e.jsx(H,{className:"mt-4",attachments:a,onDownload:n=>{s(n,{status:"downloading"}),setTimeout(()=>s(n,{status:"idle"}),900)}})},h={render:()=>e.jsx("div",{className:"max-w-3xl border border-line",children:e.jsx(o,{message:r,to:e.jsx(e.Fragment,{children:"to Alex Rivera and 2 others"}),indicators:e.jsx("div",{className:"mt-0.5 flex items-center gap-1",children:e.jsx(N,{className:"size-3.5 fill-current text-warning"})}),body:e.jsxs("div",{className:"mt-3",children:[e.jsx(C,{html:r.bodyHtml,category:"personal",allowImages:!0}),e.jsx(D,{})]})})})},B={...T.messages[0],id:"symmetry-1"},O=a=>{const t=a.querySelector("[data-pane]"),s=t?.querySelector(".message-body-frame");if(!t||!s)throw new Error("no framed message body in the pane");const n=t.getBoundingClientRect(),w=s.getBoundingClientRect();return{left:w.left-n.left,right:n.right-w.right}},I=async a=>{const{left:t,right:s}=O(a);await R(Math.abs(t-s)).toBeLessThan(1),await R(Math.abs(t)).toBeLessThan(1)},u={render:()=>e.jsx("div",{"data-pane":!0,className:"w-[900px] bg-canvas",children:e.jsx(o,{message:B})}),play:async({canvasElement:a})=>{await I(a)}},x={render:()=>e.jsx("div",{"data-pane":!0,className:"w-[390px] bg-canvas",children:e.jsx(o,{message:B})}),play:async({canvasElement:a})=>{await I(a)}},b={render:()=>e.jsx("div",{className:"max-w-3xl bg-canvas",children:e.jsx(o,{message:{...r,fromName:"Ingrid Bakker"},to:e.jsx(e.Fragment,{children:"to the choir list"}),body:e.jsx("div",{className:"mt-3",children:e.jsx(C,{text:z})})})})};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  args: {
    thread
  }
}`,...f.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    thread: newsletterThread
  }
}`,...i.parameters?.docs?.source},description:{story:`A designed newsletter rendered through the real sanitize → sandboxed-iframe
 pipeline — the same rendering the live app shows (#940). It brings its own
 background and its own 24px padding and keeps both, undoubled.`,...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    thread: newsletterThread
  },
  parameters: {
    theme: "dark"
  }
}`,...d.parameters?.docs?.source},description:{story:"The same newsletter on the dark pane: darkened as authored, not repainted.",...d.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    thread: bareThread
  }
}`,...l.parameters?.docs?.source},description:{story:`Ordinary formatted mail that declares nothing of its own. The sender header
 keeps its inset; below it the email is one surface with the pane — no card
 edge, no accent line, no app gutter beside it — with the breathing room
 inside the email's own ground.`,...l.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    thread: bareThread
  },
  parameters: {
    theme: "dark"
  }
}`,...c.parameters?.docs?.source},description:{story:`The same on the dark pane, where a lighter app-supplied ground used to show
 as a rectangle seamed into the pane.`,...c.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  args: {
    thread: undefined
  }
}`,...y.parameters?.docs?.source}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  args: {
    thread,
    canToggleIntelligence: true,
    intelligenceOpen: false
  }
}`,...v.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
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
}`,...m.parameters?.docs?.source},description:{story:'The collapsed row with the app\'s real trailing cluster (star + paperclip +\n date), an unread dot and a keyboard-focus ring — the slots the live\n MessageCard injects. The row is a `role="button"` div, so the interactive\n star in the trailing slot is a valid sibling control and not a `<button>`\n nested inside a `<button>` (#1232). Click the row to expand; the star stops\n propagation so it toggles without expanding.',...m.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-3xl border border-line">
            <ExpandedMessage message={row} senderBadge={<span className="ml-1 text-positive text-xs">✓</span>} to={<>to Alex Rivera and 2 others</>} indicators={<div className="mt-0.5 flex items-center gap-1">
                        <Star className="size-3.5 fill-current text-warning" />
                    </div>} actionMenu={<button type="button" className="rounded p-1 text-fg-subtle">
                        ⋯
                    </button>} />
        </div>
}`,...p.parameters?.docs?.source},description:{story:`The expanded row with the app's injected slots: a sender badge, an
 indicators row, an action-menu placeholder and a custom recipient line —
 proving the kit composes app interactivity without importing app code.`,...p.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  render: function RowDisclosureRender() {
    const [expanded, setExpanded] = useState(true);
    return <div className="max-w-3xl border border-line">
                {expanded ? <ExpandedMessage message={row} onHeaderClick={() => setExpanded(false)} /> : <CollapsedMessage message={row} onClick={() => setExpanded(true)} />}
            </div>;
  }
}`,...g.parameters?.docs?.source},description:{story:`The chevron beside the sender is the disclosure control, not a picture of
 one: press it to put the message away and press the row to bring it back.
 Reclaiming the space a long message takes is what a reader aims at it for.`,...g.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-3xl border border-line">
            <ExpandedMessage message={row} to={<>to Alex Rivera and 2 others</>} indicators={<div className="mt-0.5 flex items-center gap-1">
                        <Star className="size-3.5 fill-current text-warning" />
                    </div>} body={<div className="mt-3">
                        <MessageBodyView html={row.bodyHtml} category="personal" allowImages />
                        <ThreadAttachments />
                    </div>} />
        </div>
}`,...h.parameters?.docs?.source},description:{story:`The expanded row as \`MessageCard\` composes it when the message carries files
(#683): body first, attachment list under it. The indicators row holds no
paperclip — the list below is the affordance, and a second paperclip beside
the live star button only reads as a control that does nothing.`,...h.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => <div data-pane className="w-[900px] bg-canvas">
            <ExpandedMessage message={framedRow} />
        </div>,
  play: async ({
    canvasElement
  }) => {
    await assertSymmetric(canvasElement);
  }
}`,...u.parameters?.docs?.source},description:{story:"A designed newsletter on a desktop reading column.",...u.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <div data-pane className="w-[390px] bg-canvas">
            <ExpandedMessage message={framedRow} />
        </div>,
  play: async ({
    canvasElement
  }) => {
    await assertSymmetric(canvasElement);
  }
}`,...x.parameters?.docs?.source},description:{story:`The same at a phone width, where the gutter is half as wide and a lost
 right margin is half the pane's breathing room.`,...x.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-3xl bg-canvas">
            <ExpandedMessage message={{
      ...row,
      fromName: "Ingrid Bakker"
    }} to={<>to the choir list</>} body={<div className="mt-3">
                        <MessageBodyView text={PLAIN_TEXT_BODY} />
                    </div>} />
        </div>
}`,...b.parameters?.docs?.source},description:{story:`A message with no HTML part. The two body paths side by side: an email
document runs flush on its own ground, while plain text — which has neither —
keeps the message gutter and stays off the pane edge.`,...b.parameters?.docs?.description}}};const ge=["WithThread","Newsletter","NewsletterDark","BareHtmlMail","BareHtmlMailDark","Empty","WithIntelligenceToggle","CollapsedRowComposed","ExpandedRowComposed","RowDisclosure","ExpandedRowWithAttachments","FramedBodySitsSquareInThePane","FramedBodySitsSquareOnAPhone","PlainTextMessage"];export{l as BareHtmlMail,c as BareHtmlMailDark,m as CollapsedRowComposed,y as Empty,p as ExpandedRowComposed,h as ExpandedRowWithAttachments,u as FramedBodySitsSquareInThePane,x as FramedBodySitsSquareOnAPhone,i as Newsletter,d as NewsletterDark,b as PlainTextMessage,g as RowDisclosure,v as WithIntelligenceToggle,f as WithThread,ge as __namedExportsOrder,pe as default};
