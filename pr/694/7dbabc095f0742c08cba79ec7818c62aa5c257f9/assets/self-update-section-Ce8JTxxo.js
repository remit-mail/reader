import{j as e,r as w}from"./iframe-uTafckjr.js";import{B as t,a as x}from"./button-DCXIHjmE.js";import{D as N}from"./dialog-DPz7itTv.js";import{f as v,e as h}from"./self-update-sRZdiOBg.js";import{E as f}from"./external-link-CTJKTNmy.js";import{D as y}from"./download-DKsLCj9E.js";import{c as C}from"./cn-BnS_VibS.js";import{B as q}from"./badge-DAIFEfjj.js";import{B as T}from"./banner-Hh0xdm4p.js";import{T as u}from"./triangle-alert-nDKVGVDQ.js";import{R as p}from"./rotate-ccw-B0TRhxvf.js";import{L as g}from"./loader-circle-BjZYR62R.js";import{c as I}from"./createLucideIcon-DLYy-DY-.js";import{C as R}from"./clock-DBNchxVL.js";import{C as z}from"./circle-check-D9tc3L5u.js";const V=I("CloudOff",[["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193",key:"yfwify"}],["path",{d:"M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07",key:"jlfiyv"}]]),U=["Remit restarts. Mail stops loading for about a minute and this page will lose its connection while that happens.","Nothing is sent, deleted or moved. Your mail stays at your provider.","If the new version does not come back up, the version you are running now is restored automatically."];function A({open:s,currentVersion:o,release:r,appliesSchemaMigration:a=!1,onClose:l,onConfirm:d}){return s?e.jsx(N,{open:!0,onClose:l,title:`Install Remit ${r.version}`,children:e.jsxs("div",{className:"flex max-h-[80vh] flex-col",children:[e.jsxs("header",{className:"space-y-1 border-b border-line px-4 py-3",children:[e.jsxs("h3",{className:"text-sm font-semibold text-fg",children:["Install Remit ",r.version,"?"]}),e.jsxs("p",{className:"text-xs text-fg-muted",children:["You are on ",o,". ",r.version," was released"," ",v(r.releasedAt),"."]})]}),e.jsxs("div",{className:"flex-1 space-y-3 overflow-auto px-4 py-3",children:[e.jsx("p",{className:"text-sm text-fg-muted",children:r.summary}),e.jsxs("ul",{className:"space-y-2",children:[U.map(i=>e.jsxs("li",{className:"flex gap-2 text-sm text-fg-muted",children:[e.jsx("span",{className:"mt-1.5 size-1.5 shrink-0 rounded-full bg-fg-subtle"}),e.jsx("span",{children:i})]},i)),a&&e.jsxs("li",{className:"flex gap-2 text-sm text-fg-muted",children:[e.jsx("span",{className:"mt-1.5 size-1.5 shrink-0 rounded-full bg-fg-subtle"}),e.jsx("span",{children:"This version updates the database while Remit is offline. The step forward cannot be undone by hand, but a failed start is still rolled back to the version and data you have now."})]})]}),e.jsx("p",{className:"text-xs text-fg-subtle",children:"Good moment for this: when you are not waiting on a message."})]}),e.jsxs("footer",{className:"flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3",children:[e.jsx(t,{variant:"ghost",size:"sm",onClick:l,children:"Not now"}),e.jsx(x,{variant:"secondary",size:"sm",external:!0,href:r.releaseNotesUrl,icon:e.jsx(f,{className:"size-3.5"}),children:"Release notes"}),e.jsx(t,{size:"sm",icon:e.jsx(y,{className:"size-3.5"}),onClick:d,children:"Install and restart"})]})]})}):null}A.__docgenInfo={description:`Consent before the server replaces itself. Reflects what will happen in the
user's terms, in the order they will feel it, and leaves the way back open
until the moment they commit.`,methods:[],displayName:"SelfUpdateConfirmDialog",props:{open:{required:!0,tsType:{name:"boolean"},description:""},currentVersion:{required:!0,tsType:{name:"string"},description:""},release:{required:!0,tsType:{name:"ReleaseInfo"},description:""},appliesSchemaMigration:{required:!1,tsType:{name:"boolean"},description:`Whether installing this release runs a database migration during the
offline window. Stated only when the surface reports both schema versions
and the new one is higher; silence otherwise.`,defaultValue:{value:"false",computed:!1}},onClose:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""},onConfirm:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""}}};function n({children:s,tone:o}){return e.jsx("div",{className:C("rounded-sm border bg-surface px-row-inset py-3",o==="danger"?"border-danger/50":"border-line"),children:s})}function S({state:s,onCheck:o,onInstall:r,onDismissResult:a,now:l=Date.now()}){const[d,i]=w.useState(null),k=s.status==="checking",j=s.status==="available",c=()=>{if(k){i("Already checking. The result appears here in a moment.");return}i(null),o()},m=()=>{if(!j&&s.status!=="rolledBack"&&s.status!=="abandoned"){i("There is no update to install. Check for updates first — if one is found it appears here.");return}i(null),r()},b=(()=>{switch(s.status){case"upToDate":return e.jsx(n,{children:e.jsxs("div",{className:"flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",children:[e.jsxs("div",{className:"flex min-w-0 items-center gap-2",children:[e.jsx(z,{className:"size-4 shrink-0 text-positive","aria-hidden":!0}),e.jsxs("p",{className:"text-sm text-fg",children:["Remit ",s.version," is the latest version.",e.jsxs("span",{className:"text-fg-subtle",children:[" ","Checked ",h(s.checkedAt,l),"."]})]})]}),e.jsx(t,{variant:"secondary",size:"sm",className:"shrink-0",onClick:c,children:"Check again"})]})});case"checking":return e.jsx(n,{children:e.jsxs("div",{className:"flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",children:[e.jsxs("div",{className:"flex min-w-0 items-center gap-2",children:[e.jsx(g,{className:"size-4 shrink-0 animate-spin text-fg-subtle","aria-hidden":!0}),e.jsxs("p",{className:"text-sm text-fg-muted",children:["Looking for a newer version. You are on ",s.version,"."]})]}),e.jsx(t,{variant:"secondary",size:"sm",className:"shrink-0",onClick:c,children:"Check again"})]})});case"neverChecked":return e.jsx(n,{children:e.jsxs("div",{className:"flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",children:[e.jsxs("div",{className:"flex min-w-0 items-start gap-2",children:[e.jsx(R,{className:"mt-0.5 size-4 shrink-0 text-fg-subtle","aria-hidden":!0}),e.jsxs("p",{className:"text-sm text-fg-muted",children:["No update check has run yet. Remit checks for updates on its own in the background.",s.lastCheckedAt!==void 0&&e.jsxs("span",{className:"text-fg-subtle",children:[" ","Last checked"," ",h(s.lastCheckedAt,l),"."]})]})]}),e.jsx(t,{variant:"secondary",size:"sm",className:"shrink-0",onClick:c,children:"Check now"})]})});case"checkFailed":return e.jsx(n,{children:e.jsxs("div",{className:"space-y-2",children:[e.jsxs("div",{className:"flex items-start gap-2",children:[e.jsx(V,{className:"mt-0.5 size-4 shrink-0 text-fg-subtle","aria-hidden":!0}),e.jsxs("div",{className:"min-w-0 space-y-1",children:[e.jsx("p",{className:"text-sm text-fg",children:"Could not reach the update source."}),e.jsx("p",{className:"text-xs text-fg-muted",children:s.reason}),e.jsxs("p",{className:"text-xs text-fg-subtle",children:["You are still on ",s.version," and it keeps working.",s.lastCheckedAt!==void 0&&e.jsxs(e.Fragment,{children:[" ","Last successful check"," ",h(s.lastCheckedAt,l),"."]})]})]})]}),e.jsx("div",{className:"flex justify-end",children:e.jsx(t,{variant:"secondary",size:"sm",onClick:c,children:"Try again"})})]})});case"available":return e.jsx(n,{children:e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{className:"flex flex-wrap items-center gap-2",children:[e.jsxs("span",{className:"text-sm font-semibold text-fg",children:["Remit ",s.release.version]}),e.jsx(q,{tone:"accent",children:"update available"}),e.jsxs("span",{className:"text-2xs text-fg-subtle",children:["released ",v(s.release.releasedAt)," · you are on ",s.version]})]}),e.jsx("p",{className:"text-sm text-fg-muted",children:s.release.summary}),e.jsx("p",{className:"text-xs text-fg-subtle",children:"Installing restarts Remit, so mail stops loading for about a minute. If the new version does not come back up, the one you are running now is restored on its own."}),e.jsxs("div",{className:"flex flex-wrap items-center gap-2",children:[e.jsxs(t,{size:"sm",icon:e.jsx(y,{className:"size-3.5"}),onClick:m,children:["Install ",s.release.version]}),e.jsx(x,{variant:"secondary",size:"sm",external:!0,href:s.release.releaseNotesUrl,icon:e.jsx(f,{className:"size-3.5"}),children:"Release notes"})]})]})});case"applying":return e.jsx(n,{children:e.jsxs("div",{className:"flex min-w-0 items-center gap-2",children:[e.jsx(g,{className:"size-4 shrink-0 animate-spin text-accent-2","aria-hidden":!0}),e.jsxs("p",{className:"text-sm text-fg-muted",children:["Installing Remit ",s.target,". The restart screen has the details."]})]})});case"succeeded":return e.jsx(T,{tone:"success",onDismiss:a,children:e.jsxs("div",{className:"space-y-1",children:[e.jsxs("p",{className:"font-semibold",children:["Updated to Remit ",s.version,"."]}),e.jsxs("p",{children:["You were on ",s.previousVersion,"."," ",e.jsx("a",{href:s.releaseNotesUrl,target:"_blank",rel:"noopener noreferrer",className:"underline",children:"See what changed"}),"."]})]})});case"rolledBack":return e.jsx(n,{tone:"danger",children:e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{className:"flex items-start gap-2",children:[e.jsx(u,{className:"mt-0.5 size-4 shrink-0 text-danger","aria-hidden":!0}),e.jsxs("div",{className:"min-w-0 space-y-1",children:[e.jsxs("p",{className:"text-sm font-semibold text-fg",children:["Remit ",s.attemptedVersion," did not start. Remit reports that it put ",s.version," back."]}),e.jsxs("p",{className:"text-sm text-fg-muted",children:["You are running ",s.version," again. A failed update can still have changed things on the way — the log below is the only account of what it got as far as doing."]})]})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("p",{className:"text-xs text-fg-subtle",children:"What Remit reported as the failure"}),e.jsx("code",{className:"block rounded-xs bg-danger-soft px-2 py-1 text-2xs text-danger",children:s.reason})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("p",{className:"text-xs text-fg-subtle",children:"Read the full log before trying again:"}),e.jsx("code",{className:"block rounded-xs bg-surface-sunken px-2 py-1 text-2xs text-fg-muted",children:s.logsCommand})]}),e.jsxs("div",{className:"flex flex-wrap items-center gap-2",children:[e.jsxs(t,{variant:"secondary",size:"sm",icon:e.jsx(p,{className:"size-3.5"}),onClick:m,children:["Try ",s.attemptedVersion," again"]}),e.jsxs(t,{variant:"ghost",size:"sm",onClick:a,children:["Stay on ",s.version]})]})]})});case"unreachable":return e.jsx(n,{tone:"danger",children:e.jsxs("div",{className:"space-y-2",children:[e.jsxs("div",{className:"flex items-start gap-2",children:[e.jsx(u,{className:"mt-0.5 size-4 shrink-0 text-danger","aria-hidden":!0}),e.jsxs("div",{className:"min-w-0 space-y-1",children:[e.jsxs("p",{className:"text-sm font-semibold text-fg",children:["Installing ",s.attemptedVersion," left the server unreachable."]}),e.jsx("p",{className:"text-sm text-fg-muted",children:"Remit has answered again since, but nothing here can say what happened during the silence."})]})]}),e.jsx("code",{className:"block rounded-xs bg-surface-sunken px-2 py-1 text-2xs text-fg-muted",children:s.logsCommand}),e.jsx("div",{className:"flex justify-end",children:e.jsx(t,{variant:"ghost",size:"sm",onClick:a,children:"Dismiss"})})]})});case"rollbackFailed":return e.jsx(n,{tone:"danger",children:e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{className:"flex items-start gap-2",children:[e.jsx(u,{className:"mt-0.5 size-4 shrink-0 text-danger","aria-hidden":!0}),e.jsxs("div",{className:"min-w-0 space-y-1",children:[e.jsxs("p",{className:"text-sm font-semibold text-fg",children:["Remit ",s.attemptedVersion," did not start, and Remit could not put ",s.previousVersion," back."]}),e.jsx("p",{className:"text-sm text-fg-muted",children:"This is the one outcome Remit cannot resolve on its own. The server is in a half-changed state and needs you at a shell. The log below is the only account of where it stopped."})]})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("p",{className:"text-xs text-fg-subtle",children:"What Remit reported as the failure"}),e.jsx("code",{className:"block rounded-xs bg-danger-soft px-2 py-1 text-2xs text-danger",children:s.reason})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("p",{className:"text-xs text-fg-subtle",children:"Read the full log on the server:"}),e.jsx("code",{className:"block rounded-xs bg-surface-sunken px-2 py-1 text-2xs text-fg-muted",children:s.logsCommand})]}),e.jsx("div",{className:"flex justify-end",children:e.jsx(t,{variant:"ghost",size:"sm",onClick:a,children:"Dismiss"})})]})});case"abandoned":return e.jsx(n,{tone:"danger",children:e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{className:"flex items-start gap-2",children:[e.jsx(u,{className:"mt-0.5 size-4 shrink-0 text-fg-subtle","aria-hidden":!0}),e.jsxs("div",{className:"min-w-0 space-y-1",children:[e.jsxs("p",{className:"text-sm font-semibold text-fg",children:["Remit ",s.attemptedVersion," was not installed. Nothing changed."]}),e.jsxs("p",{className:"text-sm text-fg-muted",children:["The update stopped before it altered anything. You are still running ",s.version,"."]})]})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("p",{className:"text-xs text-fg-subtle",children:"What Remit reported"}),e.jsx("code",{className:"block rounded-xs bg-surface-sunken px-2 py-1 text-2xs text-fg-muted",children:s.reason})]}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("p",{className:"text-xs text-fg-subtle",children:"Read the full log before trying again:"}),e.jsx("code",{className:"block rounded-xs bg-surface-sunken px-2 py-1 text-2xs text-fg-muted",children:s.logsCommand})]}),e.jsxs("div",{className:"flex flex-wrap items-center gap-2",children:[e.jsxs(t,{variant:"secondary",size:"sm",icon:e.jsx(p,{className:"size-3.5"}),onClick:m,children:["Try ",s.attemptedVersion," again"]}),e.jsxs(t,{variant:"ghost",size:"sm",onClick:a,children:["Stay on ",s.version]})]})]})});default:return s}})();return e.jsxs("section",{className:"space-y-3",children:[e.jsxs("header",{className:"space-y-1",children:[e.jsx("h2",{className:"text-sm font-semibold text-fg",children:"Updates"}),e.jsx("p",{className:"text-xs text-fg-muted",children:"This Remit runs on your own server, so it updates when you say so. Your mail lives at your provider and is never touched by an update."})]}),b,d&&e.jsx("p",{role:"status",className:"text-xs text-fg-muted",children:d})]})}S.__docgenInfo={description:`Updates, in Settings › Advanced.

A mail client is read first and administered second, so an available update
is stated here and nowhere else — no modal, no interruption, no repeat
asking. Applying one is consequential (the server goes away and comes back),
so it is never one click from this pane.`,methods:[],displayName:"SelfUpdateSection",props:{state:{required:!0,tsType:{name:"union",raw:`| { status: "upToDate"; version: string; checkedAt: number }
| { status: "checking"; version: string }
/**
 * A configured instance whose first automatic check has not landed yet. It is
 * its own resting state, never a spinner: the updater checks on a cadence, and
 * this is the honest account of the gap before the first result arrives.
 */
| { status: "neverChecked"; version: string; lastCheckedAt?: number }
| {
		status: "checkFailed";
		version: string;
		/** Plain-language cause, e.g. "no route to github.com". */
		reason: string;
		lastCheckedAt?: number;
  }
| { status: "available"; version: string; release: ReleaseInfo }
| {
		status: "applying";
		runId: UpdateRunId;
		version: string;
		target: string;
		phase: UpdatePhase;
		/** Seconds since the user consented, for honest "still working" copy. */
		elapsedSeconds: number;
  }
| {
		status: "succeeded";
		runId: UpdateRunId;
		version: string;
		previousVersion: string;
		releaseNotesUrl: string;
  }
| {
		status: "rolledBack";
		runId: UpdateRunId;
		/** The version running now — the old one, restored. */
		version: string;
		attemptedVersion: string;
		/** The server's own account of the failure, shown verbatim. */
		reason: string;
		logsCommand: string;
  }
| {
		status: "unreachable";
		runId: UpdateRunId;
		previousVersion: string;
		attemptedVersion: string;
		elapsedSeconds: number;
		logsCommand: string;
  }
| {
		status: "rollbackFailed";
		runId: UpdateRunId;
		attemptedVersion: string;
		previousVersion: string;
		/** The server's own account of the failure, shown verbatim. */
		reason: string;
		/** The command to read the full log, shown verbatim. */
		logsCommand: string;
  }
| {
		status: "abandoned";
		runId: UpdateRunId;
		/** The version still running — the run changed nothing. */
		version: string;
		attemptedVersion: string;
		/** The server's own account of why it stopped, shown verbatim. */
		reason: string;
		/** The command to read the full log, shown verbatim. */
		logsCommand: string;
  }`,elements:[{name:"signature",type:"object",raw:'{ status: "upToDate"; version: string; checkedAt: number }',signature:{properties:[{key:"status",value:{name:"literal",value:'"upToDate"',required:!0}},{key:"version",value:{name:"string",required:!0}},{key:"checkedAt",value:{name:"number",required:!0}}]}},{name:"signature",type:"object",raw:'{ status: "checking"; version: string }',signature:{properties:[{key:"status",value:{name:"literal",value:'"checking"',required:!0}},{key:"version",value:{name:"string",required:!0}}]}},{name:"signature",type:"object",raw:'{ status: "neverChecked"; version: string; lastCheckedAt?: number }',signature:{properties:[{key:"status",value:{name:"literal",value:'"neverChecked"',required:!0}},{key:"version",value:{name:"string",required:!0}},{key:"lastCheckedAt",value:{name:"number",required:!1}}]}},{name:"signature",type:"object",raw:`{
status: "checkFailed";
version: string;
/** Plain-language cause, e.g. "no route to github.com". */
reason: string;
lastCheckedAt?: number;
}`,signature:{properties:[{key:"status",value:{name:"literal",value:'"checkFailed"',required:!0}},{key:"version",value:{name:"string",required:!0}},{key:"reason",value:{name:"string",required:!0},description:'Plain-language cause, e.g. "no route to github.com".'},{key:"lastCheckedAt",value:{name:"number",required:!1}}]}},{name:"signature",type:"object",raw:'{ status: "available"; version: string; release: ReleaseInfo }',signature:{properties:[{key:"status",value:{name:"literal",value:'"available"',required:!0}},{key:"version",value:{name:"string",required:!0}},{key:"release",value:{name:"ReleaseInfo",required:!0}}]}},{name:"signature",type:"object",raw:`{
status: "applying";
runId: UpdateRunId;
version: string;
target: string;
phase: UpdatePhase;
/** Seconds since the user consented, for honest "still working" copy. */
elapsedSeconds: number;
}`,signature:{properties:[{key:"status",value:{name:"literal",value:'"applying"',required:!0}},{key:"runId",value:{name:"string",required:!0}},{key:"version",value:{name:"string",required:!0}},{key:"target",value:{name:"string",required:!0}},{key:"phase",value:{name:"union",raw:'"preparing" | "restarting" | "reconnecting"',elements:[{name:"literal",value:'"preparing"'},{name:"literal",value:'"restarting"'},{name:"literal",value:'"reconnecting"'}],required:!0}},{key:"elapsedSeconds",value:{name:"number",required:!0},description:'Seconds since the user consented, for honest "still working" copy.'}]}},{name:"signature",type:"object",raw:`{
status: "succeeded";
runId: UpdateRunId;
version: string;
previousVersion: string;
releaseNotesUrl: string;
}`,signature:{properties:[{key:"status",value:{name:"literal",value:'"succeeded"',required:!0}},{key:"runId",value:{name:"string",required:!0}},{key:"version",value:{name:"string",required:!0}},{key:"previousVersion",value:{name:"string",required:!0}},{key:"releaseNotesUrl",value:{name:"string",required:!0}}]}},{name:"signature",type:"object",raw:`{
status: "rolledBack";
runId: UpdateRunId;
/** The version running now — the old one, restored. */
version: string;
attemptedVersion: string;
/** The server's own account of the failure, shown verbatim. */
reason: string;
logsCommand: string;
}`,signature:{properties:[{key:"status",value:{name:"literal",value:'"rolledBack"',required:!0}},{key:"runId",value:{name:"string",required:!0}},{key:"version",value:{name:"string",required:!0},description:"The version running now — the old one, restored."},{key:"attemptedVersion",value:{name:"string",required:!0}},{key:"reason",value:{name:"string",required:!0},description:"The server's own account of the failure, shown verbatim."},{key:"logsCommand",value:{name:"string",required:!0}}]}},{name:"signature",type:"object",raw:`{
status: "unreachable";
runId: UpdateRunId;
previousVersion: string;
attemptedVersion: string;
elapsedSeconds: number;
logsCommand: string;
}`,signature:{properties:[{key:"status",value:{name:"literal",value:'"unreachable"',required:!0}},{key:"runId",value:{name:"string",required:!0}},{key:"previousVersion",value:{name:"string",required:!0}},{key:"attemptedVersion",value:{name:"string",required:!0}},{key:"elapsedSeconds",value:{name:"number",required:!0}},{key:"logsCommand",value:{name:"string",required:!0}}]}},{name:"signature",type:"object",raw:`{
status: "rollbackFailed";
runId: UpdateRunId;
attemptedVersion: string;
previousVersion: string;
/** The server's own account of the failure, shown verbatim. */
reason: string;
/** The command to read the full log, shown verbatim. */
logsCommand: string;
}`,signature:{properties:[{key:"status",value:{name:"literal",value:'"rollbackFailed"',required:!0}},{key:"runId",value:{name:"string",required:!0}},{key:"attemptedVersion",value:{name:"string",required:!0}},{key:"previousVersion",value:{name:"string",required:!0}},{key:"reason",value:{name:"string",required:!0},description:"The server's own account of the failure, shown verbatim."},{key:"logsCommand",value:{name:"string",required:!0},description:"The command to read the full log, shown verbatim."}]}},{name:"signature",type:"object",raw:`{
status: "abandoned";
runId: UpdateRunId;
/** The version still running — the run changed nothing. */
version: string;
attemptedVersion: string;
/** The server's own account of why it stopped, shown verbatim. */
reason: string;
/** The command to read the full log, shown verbatim. */
logsCommand: string;
}`,signature:{properties:[{key:"status",value:{name:"literal",value:'"abandoned"',required:!0}},{key:"runId",value:{name:"string",required:!0}},{key:"version",value:{name:"string",required:!0},description:"The version still running — the run changed nothing."},{key:"attemptedVersion",value:{name:"string",required:!0}},{key:"reason",value:{name:"string",required:!0},description:"The server's own account of why it stopped, shown verbatim."},{key:"logsCommand",value:{name:"string",required:!0},description:"The command to read the full log, shown verbatim."}]}}]},description:""},onCheck:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""},onInstall:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:"Opens consent before anything is replaced."},onDismissResult:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:"Clears a finished result from the pane. Required: it is the only exit\nfrom `succeeded` and `rolledBack`, and without it the pane sticks on a\nred failure row for good."},now:{required:!1,tsType:{name:"number"},description:'Fixed "now" so stories and tests read the same relative times.',defaultValue:{value:"Date.now()",computed:!0}}}};export{S,A as a};
