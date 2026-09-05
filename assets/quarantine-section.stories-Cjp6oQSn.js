import{j as e,r as d}from"./iframe-uufGNBEn.js";import{Q as l,a as p}from"./quarantine-section-CrillMvw.js";import{q as g}from"./quarantine-fixtures-CeVMvlCw.js";import"./preload-helper-PPVm8Dsz.js";import"./button-Wi0n0Lyz.js";import"./cn-d2XQ1MEC.js";import"./dialog-DIXzXjmg.js";import"./overlay-scope-DDGgBdDi.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-initial-focus-BI_G8RKS.js";import"./dialog-backdrop-Cp-aOj13.js";import"./createLucideIcon-Bn-Stmx4.js";import"./external-link-CFmA3EUF.js";import"./banner-D7bQEtJc.js";import"./x-CuwWA0oJ.js";import"./folder-tree-ZE9Jqoy_.js";import"./badge-DS2l7jE5.js";import"./folder-role-DLEscJf7.js";import"./inbox-CimnAjxx.js";import"./file-text-wmSXByn2.js";import"./send-Auw0BsZV.js";import"./mails-DEIX_BNC.js";import"./octagon-alert-jmFTGl01.js";import"./trash-2-RI1RlAl9.js";import"./star-Cwq7Iobx.js";import"./bug-DeHDf7Wr.js";import"./circle-check-BE50fXLz.js";import"./triangle-alert-BMnL-Txz.js";const[u,x,h,B]=g,m="https://github.com/remit-mail/reader/issues/new",L={title:"Settings/Quarantine",component:l,parameters:{layout:"padded"},args:{onCutBug:()=>{}},decorators:[i=>e.jsx("div",{className:"mx-auto max-w-2xl",children:e.jsx(i,{})})]},t={args:{entries:[]}},s={args:{entries:[u]}},o={args:{entries:[u,x,h]}},n={render:()=>{const[i,c]=d.useState(null),[y,C]=d.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(l,{entries:g,onCutBug:c}),y&&e.jsx("p",{className:"mt-3 text-xs text-positive",children:"Report copied."}),e.jsx(p,{entry:i,issueUrl:m,onClose:()=>c(null),onCopy:()=>C(!0)})]})}},r={render:()=>e.jsx(p,{entry:B,issueUrl:m,onClose:()=>{},onCopy:()=>{}})},a={render:()=>e.jsx(p,{entry:u,issueUrl:m,onClose:()=>{},onCopy:()=>{}})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
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
