import{j as e,r as x}from"./iframe-BxLfZl0d.js";import{A as g}from"./attachment-list-Curyi-58.js";import"./preload-helper-PPVm8Dsz.js";import"./attachment-file-qTo3Y5Tj.js";import"./cn-d2XQ1MEC.js";import"./paperclip-BuRqVWrf.js";import"./createLucideIcon-DDkWk8mg.js";import"./loader-circle-tcZ5ujJC.js";import"./download-BDc64jbo.js";import"./circle-alert-dyRtukXU.js";const H={title:"Mail/AttachmentList",component:g,parameters:{layout:"padded",docs:{description:{component:`The attachment list on an open message (#683). Every row saves a file, so
every row is a button; the paperclip in the heading is the only glyph and it
is decoration. Nothing here fetches — the app owns the download and hands
back per-row state, which is what makes the failure story below the same
component the app renders.`}}}},l={attachmentId:"part-2",filename:"Q3 board pack.pdf",typeLabel:"PDF",sizeOctets:2411724,download:{status:"idle"}},p={attachmentId:"part-3",filename:"site-plan.png",typeLabel:"PNG",sizeOctets:486120,download:{status:"idle"}},I=900,a=({attachments:f,hasUnlistedAttachment:y})=>{const[h,b]=x.useState(f),u=(s,t)=>b(m=>m.map(w=>w.attachmentId===s?t:w)),L=s=>{const t=h.find(m=>m.attachmentId===s);!t||t.download.status==="downloading"||(u(s,{...t,download:{status:"downloading"}}),setTimeout(()=>u(s,{...t,download:{status:"idle"}}),I))};return e.jsx(g,{attachments:h,onDownload:L,hasUnlistedAttachment:y})},d={render:()=>e.jsx(a,{attachments:[l]})},c={render:()=>e.jsx(a,{attachments:[l,p,{attachmentId:"part-4",filename:"notes.txt",typeLabel:"PLAIN",sizeOctets:812,download:{status:"idle"}},{attachmentId:"part-5",filename:"archive",typeLabel:"FILE",sizeOctets:1024**3+1024**2*200,download:{status:"idle"}}]})},n={render:()=>e.jsx(a,{attachments:[{...l,download:{status:"downloading"}},p]})},r={render:()=>e.jsx(a,{attachments:[{...l,download:{status:"failed",title:"This attachment is missing from storage",detail:"Remit has the message but not the file. Re-sync the account from Settings, then try again.",reportUrl:"https://github.com/remit-mail/reader/issues/new"}},p]})},o={render:()=>e.jsx(a,{attachments:[{attachmentId:"part-6",filename:"passwd",typeLabel:"FILE",sizeOctets:3120,download:{status:"idle"}},{attachmentId:"part-7",filename:"invoicegnp.exe",typeLabel:"FILE",sizeOctets:118400,download:{status:"idle"}},{attachmentId:"part-8",filename:`${"long-name-".repeat(11)}report.pdf`,typeLabel:"PDF",sizeOctets:44e3,download:{status:"idle"}}]})},i={render:()=>e.jsx(a,{attachments:[],hasUnlistedAttachment:!0})};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Harness attachments={[report]} />
}`,...d.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <Harness attachments={[report, sitePlan, {
    attachmentId: "part-4",
    filename: "notes.txt",
    typeLabel: "PLAIN",
    sizeOctets: 812,
    download: {
      status: "idle"
    }
  }, {
    attachmentId: "part-5",
    filename: "archive",
    typeLabel: "FILE",
    sizeOctets: 1024 ** 3 + 1024 ** 2 * 200,
    download: {
      status: "idle"
    }
  }]} />
}`,...c.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Harness attachments={[{
    ...report,
    download: {
      status: "downloading"
    }
  }, sitePlan]} />
}`,...n.parameters?.docs?.source},description:{story:"One row mid-fetch. The rows beside it are still pressable.",...n.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Harness attachments={[{
    ...report,
    download: {
      status: "failed",
      title: "This attachment is missing from storage",
      detail: "Remit has the message but not the file. Re-sync the account from Settings, then try again.",
      reportUrl: "https://github.com/remit-mail/reader/issues/new"
    }
  }, sitePlan]} />
}`,...r.parameters?.docs?.source},description:{story:`A fetch that failed. The row keeps its control, and the alert underneath
names what broke and what to do about it — a dead click that leaves the user
guessing whether the app, the server or they themselves are at fault is the
outcome this list exists to make impossible.`,...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Harness attachments={[{
    attachmentId: "part-6",
    filename: "passwd",
    typeLabel: "FILE",
    sizeOctets: 3_120,
    download: {
      status: "idle"
    }
  }, {
    attachmentId: "part-7",
    filename: "invoicegnp.exe",
    typeLabel: "FILE",
    sizeOctets: 118_400,
    download: {
      status: "idle"
    }
  }, {
    attachmentId: "part-8",
    filename: \`\${"long-name-".repeat(11)}report.pdf\`,
    typeLabel: "PDF",
    sizeOctets: 44_000,
    download: {
      status: "idle"
    }
  }]} />
}`,...o.parameters?.docs?.source},description:{story:"Names written to deceive, as `sanitizeAttachmentFilename` leaves them. The\nsenders wrote `../../../etc/passwd`, `invoice<RLO>gnp.exe` — which renders as\n`invoiceexe.png` with the override intact — and 400 characters of padding.\nThe list shows exactly the name the file is saved under, so what is read is\nwhat lands.",...o.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Harness attachments={[]} hasUnlistedAttachment />
}`,...i.parameters?.docs?.source},description:{story:`The mail server flagged the message as carrying an attachment, but no body
part describes one. Saying nothing here is what made the original paperclip
read as broken.`,...i.parameters?.docs?.description}}};const T=["OneAttachment","SeveralAttachments","Downloading","DownloadFailed","HostileFilename","UnlistedAttachment"];export{r as DownloadFailed,n as Downloading,o as HostileFilename,d as OneAttachment,c as SeveralAttachments,i as UnlistedAttachment,T as __namedExportsOrder,H as default};
