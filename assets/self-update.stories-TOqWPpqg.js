import{j as t,r as T}from"./iframe-BxLfZl0d.js";import{d as s,c as r,a as w}from"./self-update-sRZdiOBg.js";import{S as x,a as b}from"./self-update-section-DAVVomEB.js";import"./preload-helper-PPVm8Dsz.js";import"./button-y3nctzTP.js";import"./cn-d2XQ1MEC.js";import"./dialog-eylec2KB.js";import"./dialog-backdrop-Bi3FaUL6.js";import"./external-link-DqT_wRnl.js";import"./createLucideIcon-DDkWk8mg.js";import"./download-BDc64jbo.js";import"./badge-Bz4-5UiN.js";import"./banner-DLDN0WMz.js";import"./x-BYZsfpI2.js";import"./triangle-alert-C1LDOpRR.js";import"./rotate-ccw-C97OaACd.js";import"./loader-circle-tcZ5ujJC.js";import"./clock-L-8RlEWY.js";import"./circle-check-eI2De_DD.js";const y=Date.parse("2026-07-20T12:00:00.000Z"),e="0.9.3",G={title:"Settings/Self-update",component:x,parameters:{layout:"padded"},args:{now:y,onCheck:()=>{},onInstall:()=>{},onDismissResult:()=>{}},decorators:[a=>t.jsx("div",{className:"mx-auto max-w-2xl",children:t.jsx(a,{})})]},n=a=>({state:a}),o={args:n({status:"upToDate",version:e,checkedAt:y-21*6e4})},k={args:n({status:"checking",version:e})},i={args:n({status:"neverChecked",version:"unknown"})},d={args:n({status:"available",version:e,release:s})},c={args:n({status:"checkFailed",version:e,reason:"No route to github.com — the server has no outbound network.",lastCheckedAt:y-4320*6e4})},l={args:n({status:"succeeded",runId:r,version:s.version,previousVersion:e,releaseNotesUrl:s.releaseNotesUrl})},m={args:n({status:"rolledBack",runId:r,version:e,attemptedVersion:s.version,reason:'migration 0042_add_thread_index failed: relation "threads" does not exist',logsCommand:w})},p={args:n({status:"rollbackFailed",runId:r,attemptedVersion:s.version,previousVersion:e,reason:"migration 0042_add_thread_index failed and the snapshot restore errored: database is locked",logsCommand:w})},h={args:n({status:"abandoned",runId:r,version:e,attemptedVersion:s.version,reason:"manifest fetch timed out before anything was pulled",logsCommand:w})},u={args:n({status:"applying",runId:r,version:e,target:s.version,phase:"restarting",elapsedSeconds:30})},g={args:n({status:"unreachable",runId:r,previousVersion:e,attemptedVersion:s.version,elapsedSeconds:420,logsCommand:w})},f={render:()=>t.jsx(b,{open:!0,currentVersion:e,release:s,onClose:()=>{},onConfirm:()=>{}})},v={render:()=>t.jsx(b,{open:!0,currentVersion:e,release:s,appliesSchemaMigration:!0,onClose:()=>{},onConfirm:()=>{}})},C={render:()=>{const[a,S]=T.useState(!1),[N,U]=T.useState(!1);return t.jsxs(t.Fragment,{children:[t.jsx(x,{now:y,state:{status:"available",version:e,release:s},onCheck:()=>{},onInstall:()=>S(!0),onDismissResult:()=>{}}),N&&t.jsx("p",{className:"mt-3 text-xs text-fg-subtle",children:"Consent given — the app hands over to the blocking restart screen here."}),t.jsx(b,{open:a,currentVersion:e,release:s,onClose:()=>S(!1),onConfirm:()=>{S(!1),U(!0)}})]})}},R={args:n({status:"checking",version:e}),play:async({canvasElement:a})=>{a.querySelector("button")?.click()}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "upToDate",
    version: CURRENT,
    checkedAt: NOW - 21 * 60_000
  })
}`,...o.parameters?.docs?.source},description:{story:`The state this pane is in almost always. One line, no call to action, no
colour — running the latest version is not news.`,...o.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "checking",
    version: CURRENT
  })
}`,...k.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "neverChecked",
    version: "unknown"
  })
}`,...i.parameters?.docs?.source},description:{story:`A fresh, configured instance before its first automatic check has landed. The
honest resting state, not a spinner: it says a check has not run and that Remit
checks on its own, and offers a manual check. This is what every install shows
until the updater writes its first result.`,...i.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "available",
    version: CURRENT,
    release: demoRelease
  })
}`,...d.parameters?.docs?.source},description:{story:`An update exists. It is stated — version, date, one line of what changes, a
link to the full notes — and then it waits. Nothing here follows the user
back to their mail.`,...d.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "checkFailed",
    version: CURRENT,
    reason: "No route to github.com — the server has no outbound network.",
    lastCheckedAt: NOW - 3 * 24 * 60 * 60_000
  })
}`,...c.parameters?.docs?.source},description:{story:`Cannot reach the update source. This is not a failure of the running Remit
and does not dress itself up as one: it names the cause, says the installed
version keeps working, and offers the retry.`,...c.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "succeeded",
    runId: demoRunId,
    version: demoRelease.version,
    previousVersion: CURRENT,
    releaseNotesUrl: demoRelease.releaseNotesUrl
  })
}`,...l.parameters?.docs?.source},description:{story:`Back on a reachable server, on the new version. Dismissible, and gone for
good once dismissed.`,...l.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "rolledBack",
    runId: demoRunId,
    version: CURRENT,
    attemptedVersion: demoRelease.version,
    reason: 'migration 0042_add_thread_index failed: relation "threads" does not exist',
    logsCommand: demoLogsCommand
  })
}`,...m.parameters?.docs?.source},description:{story:`The new version did not start and Remit reports having put the old one back.
The pane repeats that report and no more: a failed migration is exactly the
case where something was changed on the way, so "nothing was lost" is not a
claim this screen is in any position to make.`,...m.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "rollbackFailed",
    runId: demoRunId,
    attemptedVersion: demoRelease.version,
    previousVersion: CURRENT,
    reason: "migration 0042_add_thread_index failed and the snapshot restore errored: database is locked",
    logsCommand: demoLogsCommand
  })
}`,...p.parameters?.docs?.source},description:{story:`The new version did not start and the rollback to the old one failed too.
The one outcome Remit cannot resolve on its own: it names the failure and the
log verbatim, claims no running version, and sends the operator to a shell.`,...p.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "abandoned",
    runId: demoRunId,
    version: CURRENT,
    attemptedVersion: demoRelease.version,
    reason: "manifest fetch timed out before anything was pulled",
    logsCommand: demoLogsCommand
  })
}`,...h.parameters?.docs?.source},description:{story:`The run stopped before it changed anything — a manifest that could not be
fetched, a preflight that refused. Nothing was installed and nothing was
touched, so the pane says exactly that and offers the retry.`,...h.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "applying",
    runId: demoRunId,
    version: CURRENT,
    target: demoRelease.version,
    phase: "restarting",
    elapsedSeconds: 30
  })
}`,...u.parameters?.docs?.source},description:{story:`An update is running. The blocking screen owns the window; the pane behind it
still says what is going on rather than going blank.`,...u.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "unreachable",
    runId: demoRunId,
    previousVersion: CURRENT,
    attemptedVersion: demoRelease.version,
    elapsedSeconds: 420,
    logsCommand: demoLogsCommand
  })
}`,...g.parameters?.docs?.source},description:{story:`The server answered again after a silence the client could not see into. It
says exactly that, and points at the log rather than guessing.`,...g.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  render: () => <SelfUpdateConfirmDialog open currentVersion={CURRENT} release={demoRelease} onClose={() => {}} onConfirm={() => {}} />
}`,...f.parameters?.docs?.source},description:{story:`Consent. Reflects the three things the user will actually feel — the pause,
that mail is untouched, and the automatic way back — before anything is
replaced. "Not now" is always the easiest button to hit.`,...f.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  render: () => <SelfUpdateConfirmDialog open currentVersion={CURRENT} release={demoRelease} appliesSchemaMigration onClose={() => {}} onConfirm={() => {}} />
}`,...v.parameters?.docs?.source},description:{story:`Consent for a release that also migrates the database. The extra line states
the forward step is one-way but a failed start is still rolled back — shown
only when the surface reports a higher schema version than the running one.`,...v.parameters?.docs?.description}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [open, setOpen] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    return <>
                <SelfUpdateSection now={NOW} state={{
        status: "available",
        version: CURRENT,
        release: demoRelease
      }} onCheck={() => {}} onInstall={() => setOpen(true)} onDismissResult={() => {}} />
                {confirmed && <p className="mt-3 text-xs text-fg-subtle">
                        Consent given — the app hands over to the blocking restart screen
                        here.
                    </p>}
                <SelfUpdateConfirmDialog open={open} currentVersion={CURRENT} release={demoRelease} onClose={() => setOpen(false)} onConfirm={() => {
        setOpen(false);
        setConfirmed(true);
      }} />
            </>;
  }
}`,...C.parameters?.docs?.source},description:{story:`Consent reached from the pane, and declined. The offer stays exactly where
it was; declining costs nothing and is not asked about again.`,...C.parameters?.docs?.description}}};R.parameters={...R.parameters,docs:{...R.parameters?.docs,source:{originalSource:`{
  args: withState({
    status: "checking",
    version: CURRENT
  }),
  play: async ({
    canvasElement
  }) => {
    canvasElement.querySelector<HTMLButtonElement>("button")?.click();
  }
}`,...R.parameters?.docs?.source},description:{story:`Pressing "Check again" while a check is already running. The control is
never disabled — it no-ops and says why, per the UX tenets.`,...R.parameters?.docs?.description}}};const J=["UpToDate","Checking","NeverChecked","UpdateAvailable","CheckFailedOffline","Succeeded","RolledBack","RollbackFailed","Abandoned","ApplyingBehindTheOverlay","RecoveredAfterUnreachable","ConfirmBeforeInstalling","ConfirmWithSchemaMigration","ConsentFlow","PressingCheckWhileChecking"];export{h as Abandoned,u as ApplyingBehindTheOverlay,c as CheckFailedOffline,k as Checking,f as ConfirmBeforeInstalling,v as ConfirmWithSchemaMigration,C as ConsentFlow,i as NeverChecked,R as PressingCheckWhileChecking,g as RecoveredAfterUnreachable,p as RollbackFailed,m as RolledBack,l as Succeeded,o as UpToDate,d as UpdateAvailable,J as __namedExportsOrder,G as default};
