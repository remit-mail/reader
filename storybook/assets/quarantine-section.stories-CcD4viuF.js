import{j as e,r as d}from"./iframe-R-hq3KXP.js";import{Q as l,a as p}from"./quarantine-section-qStxhOBA.js";import{q as g}from"./quarantine-fixtures-CeVMvlCw.js";import"./preload-helper-PPVm8Dsz.js";import"./button-DALtMcT0.js";import"./cn-d2XQ1MEC.js";import"./dialog-DPsoMDN5.js";import"./overlay-scope-CbgdyXI5.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-modal-focus-BNTAB0Hf.js";import"./dialog-backdrop-BIH6Z9bE.js";import"./createLucideIcon-BDKPi14T.js";import"./external-link-BFzqYGrL.js";import"./banner-BhQiwCh2.js";import"./x-Czc64qis.js";import"./folder-tree-ZE9Jqoy_.js";import"./badge-WI2U-Zts.js";import"./folder-role-D3HVA3Iq.js";import"./inbox-D-FyjlM1.js";import"./file-text-CJ_w3JkX.js";import"./send-fSuxqJkf.js";import"./mails-CUP9kWvq.js";import"./octagon-alert-DfH6ykI_.js";import"./trash-2-DVhxVVfp.js";import"./star-rV5iOHKe.js";import"./bug-D32KUFLM.js";import"./circle-check-qZ5D4I64.js";import"./triangle-alert-BzRaASrO.js";const[u,x,h,B]=g,m="https://github.com/remit-mail/reader/issues/new",L={title:"Settings/Quarantine",component:l,parameters:{layout:"padded"},args:{onCutBug:()=>{}},decorators:[i=>e.jsx("div",{className:"mx-auto max-w-2xl",children:e.jsx(i,{})})]},t={args:{entries:[]}},s={args:{entries:[u]}},o={args:{entries:[u,x,h]}},n={render:()=>{const[i,c]=d.useState(null),[y,C]=d.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(l,{entries:g,onCutBug:c}),y&&e.jsx("p",{className:"mt-3 text-xs text-positive",children:"Report copied."}),e.jsx(p,{entry:i,issueUrl:m,onClose:()=>c(null),onCopy:()=>C(!0)})]})}},r={render:()=>e.jsx(p,{entry:B,issueUrl:m,onClose:()=>{},onCopy:()=>{}})},a={render:()=>e.jsx(p,{entry:u,issueUrl:m,onClose:()=>{},onCopy:()=>{}})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    entries: []
  }
}`,...t.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    entries: [unterminatedBoundary]
  }
}`,...s.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    entries: [unterminatedBoundary, unknownCharset, truncatedBody]
  }
}`,...o.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [open, setOpen] = useState<QuarantineEntry | null>(null);
    const [copied, setCopied] = useState(false);
    return <>
                <QuarantineSection entries={quarantineDemoEntries} onCutBug={setOpen} />
                {copied && <p className="mt-3 text-xs text-positive">Report copied.</p>}
                <QuarantineBugDialog entry={open} issueUrl={demoIssueUrl} onClose={() => setOpen(null)} onCopy={() => setCopied(true)} />
            </>;
  }
}`,...n.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <QuarantineBugDialog entry={shapeUnread} issueUrl={demoIssueUrl} onClose={() => {}} onCopy={() => {}} />
}`,...r.parameters?.docs?.source},description:{story:`A message that failed before its BODYSTRUCTURE was read carries no content
type, encoding, size or MIME tree, and one that declared no Message-ID
carries no hash. The report says so rather than printing an empty value.`,...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <QuarantineBugDialog entry={unterminatedBoundary} issueUrl={demoIssueUrl} onClose={() => {}} onCopy={() => {}} />
}`,...a.parameters?.docs?.source}}};const P=["Empty","OneEntry","AlertState","CutABugFlow","BugReportWithoutMessageShape","BugReport"];export{o as AlertState,a as BugReport,r as BugReportWithoutMessageShape,n as CutABugFlow,t as Empty,s as OneEntry,P as __namedExportsOrder,L as default};
