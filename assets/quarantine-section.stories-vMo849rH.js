import{j as e,r as d}from"./iframe-BxLfZl0d.js";import{Q as l,a as p}from"./quarantine-section-zIjsNdMK.js";import{q as g}from"./quarantine-fixtures-D9h4BXK6.js";import"./preload-helper-PPVm8Dsz.js";import"./button-y3nctzTP.js";import"./cn-d2XQ1MEC.js";import"./dialog-eylec2KB.js";import"./dialog-backdrop-Bi3FaUL6.js";import"./createLucideIcon-DDkWk8mg.js";import"./external-link-DqT_wRnl.js";import"./banner-DLDN0WMz.js";import"./x-BYZsfpI2.js";import"./badge-Bz4-5UiN.js";import"./folder-role-dmq7aBm0.js";import"./inbox-DwY9RJbq.js";import"./mails-Dvt-mx6n.js";import"./send-DMtwrNan.js";import"./octagon-alert-CBmLBGXA.js";import"./trash-2-DGdeO5MV.js";import"./star-BnMPyPKH.js";import"./bug-D1uHXz12.js";import"./circle-check-eI2De_DD.js";import"./triangle-alert-C1LDOpRR.js";const[u,x,h,B]=g,m="https://github.com/remit-mail/reader/issues/new",Y={title:"Settings/Quarantine",component:l,parameters:{layout:"padded"},args:{onCutBug:()=>{}},decorators:[i=>e.jsx("div",{className:"mx-auto max-w-2xl",children:e.jsx(i,{})})]},t={args:{entries:[]}},s={args:{entries:[u]}},o={args:{entries:[u,x,h]}},n={render:()=>{const[i,c]=d.useState(null),[y,C]=d.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(l,{entries:g,onCutBug:c}),y&&e.jsx("p",{className:"mt-3 text-xs text-positive",children:"Report copied."}),e.jsx(p,{entry:i,issueUrl:m,onClose:()=>c(null),onCopy:()=>C(!0)})]})}},r={render:()=>e.jsx(p,{entry:B,issueUrl:m,onClose:()=>{},onCopy:()=>{}})},a={render:()=>e.jsx(p,{entry:u,issueUrl:m,onClose:()=>{},onCopy:()=>{}})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source}}};const G=["Empty","OneEntry","AlertState","CutABugFlow","BugReportWithoutMessageShape","BugReport"];export{o as AlertState,a as BugReport,r as BugReportWithoutMessageShape,n as CutABugFlow,t as Empty,s as OneEntry,G as __namedExportsOrder,Y as default};
