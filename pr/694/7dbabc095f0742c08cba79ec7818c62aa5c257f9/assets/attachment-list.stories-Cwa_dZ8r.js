import{A as d}from"./attachment-list-DpbJMjSm.js";import"./iframe-uTafckjr.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./paperclip-DfghAzH8.js";import"./createLucideIcon-DLYy-DY-.js";import"./loader-circle-BjZYR62R.js";import"./download-DKsLCj9E.js";import"./circle-alert-DcdQfpU2.js";const b={title:"Mail/AttachmentList",component:d,parameters:{layout:"padded",docs:{description:{component:`The attachment list on an open message (#683). Every row saves a file, so
every row is a button; the paperclip in the heading is the only glyph and it
is decoration. Nothing here fetches — the app owns the download and hands
back per-row state, which is what makes the failure story below the same
component the app renders.`}}}},i={attachmentId:"part-2",filename:"Q3 board pack.pdf",typeLabel:"PDF",sizeOctets:2411724,download:{status:"idle"}},s={args:{attachments:[i],onDownload:e=>alert(`Download ${e}`)}},o={args:{attachments:[i,{attachmentId:"part-3",filename:"site-plan.png",typeLabel:"PNG",sizeOctets:486120,download:{status:"idle"}},{attachmentId:"part-4",filename:"notes.txt",typeLabel:"PLAIN",sizeOctets:812,download:{status:"idle"}},{attachmentId:"part-5",filename:"archive",typeLabel:"FILE",sizeOctets:1024**3+1024**2*200,download:{status:"idle"}}],onDownload:e=>alert(`Download ${e}`)}},r={args:{attachments:[{...i,download:{status:"downloading"}},{attachmentId:"part-3",filename:"site-plan.png",typeLabel:"PNG",sizeOctets:486120,download:{status:"idle"}}],onDownload:e=>alert(`Download ${e}`)}},t={args:{attachments:[{...i,download:{status:"failed",title:"This attachment is missing from storage",detail:"Remit has the message but not the file. Re-sync the account from Settings, then try again.",reportUrl:"https://github.com/remit-mail/reader/issues/new"}},{attachmentId:"part-3",filename:"site-plan.png",typeLabel:"PNG",sizeOctets:486120,download:{status:"idle"}}],onDownload:e=>alert(`Download ${e}`)}},a={args:{attachments:[{attachmentId:"part-6",filename:"passwd",typeLabel:"FILE",sizeOctets:3120,download:{status:"idle"}},{attachmentId:"part-7",filename:"invoicegnp.exe",typeLabel:"FILE",sizeOctets:118400,download:{status:"idle"}},{attachmentId:"part-8",filename:`${"long-name-".repeat(11)}report.pdf`,typeLabel:"PDF",sizeOctets:44e3,download:{status:"idle"}}],onDownload:e=>alert(`Download ${e}`)}},n={args:{attachments:[],onDownload:()=>{},hasUnlistedAttachment:!0}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    attachments: [report],
    onDownload: id => alert(\`Download \${id}\`)
  }
}`,...s.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    attachments: [report, {
      attachmentId: "part-3",
      filename: "site-plan.png",
      typeLabel: "PNG",
      sizeOctets: 486_120,
      download: {
        status: "idle"
      }
    }, {
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
    }],
    onDownload: id => alert(\`Download \${id}\`)
  }
}`,...o.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    attachments: [{
      ...report,
      download: {
        status: "downloading"
      }
    }, {
      attachmentId: "part-3",
      filename: "site-plan.png",
      typeLabel: "PNG",
      sizeOctets: 486_120,
      download: {
        status: "idle"
      }
    }],
    onDownload: id => alert(\`Download \${id}\`)
  }
}`,...r.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    attachments: [{
      ...report,
      download: {
        status: "failed",
        title: "This attachment is missing from storage",
        detail: "Remit has the message but not the file. Re-sync the account from Settings, then try again.",
        reportUrl: "https://github.com/remit-mail/reader/issues/new"
      }
    }, {
      attachmentId: "part-3",
      filename: "site-plan.png",
      typeLabel: "PNG",
      sizeOctets: 486_120,
      download: {
        status: "idle"
      }
    }],
    onDownload: id => alert(\`Download \${id}\`)
  }
}`,...t.parameters?.docs?.source},description:{story:`A fetch that failed. The row keeps its control, and the alert underneath
names what broke and what to do about it — a dead click that leaves the user
guessing whether the app, the server or they themselves are at fault is the
outcome this list exists to make impossible.`,...t.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    attachments: [{
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
    }],
    onDownload: id => alert(\`Download \${id}\`)
  }
}`,...a.parameters?.docs?.source},description:{story:"Names written to deceive, as `sanitizeAttachmentFilename` leaves them. The\nsenders wrote `../../../etc/passwd`, `invoice<RLO>gnp.exe` — which renders as\n`invoiceexe.png` with the override intact — and 400 characters of padding.\nThe list shows exactly the name the file is saved under, so what is read is\nwhat lands.",...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    attachments: [],
    onDownload: () => undefined,
    hasUnlistedAttachment: true
  }
}`,...n.parameters?.docs?.source},description:{story:`The mail server flagged the message as carrying an attachment, but no body
part describes one. Saying nothing here is what made the original paperclip
read as broken.`,...n.parameters?.docs?.description}}};const D=["OneAttachment","SeveralAttachments","Downloading","DownloadFailed","HostileFilename","UnlistedAttachment"];export{t as DownloadFailed,r as Downloading,a as HostileFilename,s as OneAttachment,o as SeveralAttachments,n as UnlistedAttachment,D as __namedExportsOrder,b as default};
