import{C as i}from"./confirm-dialog-DZtrzTeN.js";import"./iframe-BxLfZl0d.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./dialog-backdrop-Bi3FaUL6.js";const p={title:"Primitives/ConfirmDialog",component:i,parameters:{layout:"centered"},args:{isOpen:!0,title:"Move 3,412 messages to Trash?",description:"You can restore them from Trash later.",confirmLabel:"Move to Trash",destructive:!0,onConfirm:()=>{},onCancel:()=>{}}},e={},n={args:{title:"Move 1 message to Trash?"}},t={args:{isBusy:!0}},s={args:{title:"Archive 12 messages?",description:void 0,confirmLabel:"Archive",destructive:!1}},r={args:{title:"Permanently delete 12 messages?",description:"They are erased from the mail server and cannot be restored.",confirmLabel:"Delete permanently"}},a={args:{title:"Delete 12 messages?",description:"Checking where this account files deleted mail…",confirmLabel:"Delete",isBusy:!0}},o={args:{title:"Can't delete 12 messages",description:"reader couldn't read this account's folder settings, so it can't say whether this would move the mail to Trash or erase it. Nothing has been deleted.",confirmLabel:"Sign in again",destructive:!1}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:"{}",...e.parameters?.docs?.source},description:{story:`A single corner tap on the bar's delete icon used to fall straight through
to a delete with nothing in between — this is what now sits in the way.
Wording says "Move … to Trash", not "Delete": the operation is reversible
(IMAP delete moves to Trash), and the confirmation copy says so rather than
reading as final.`,...e.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    title: "Move 1 message to Trash?"
  }
}`,...n.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    isBusy: true
  }
}`,...t.parameters?.docs?.source},description:{story:`The mutation is in flight: the confirm button disables rather than
 allowing a second concurrent delete request.`,...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    title: "Archive 12 messages?",
    description: undefined,
    confirmLabel: "Archive",
    destructive: false
  }
}`,...s.parameters?.docs?.source},description:{story:"A non-destructive confirmation (no `destructive`) uses the accent\n affirmative styling instead of danger.",...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    title: "Permanently delete 12 messages?",
    description: "They are erased from the mail server and cannot be restored.",
    confirmLabel: "Delete permanently"
  }
}`,...r.parameters?.docs?.source},description:{story:`Deleting mail that already sits in Trash expunges it on the server, so the
dialog asks that question instead of "move to Trash?" — the wording follows
the consequence, never the button that opened it (#845). On Flagged and the
brief the rows span mailboxes, and one row bound for an expunge is enough to
make the whole delete unrecoverable, so a mixed set is asked here too (#855).`,...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    title: "Delete 12 messages?",
    description: "Checking where this account files deleted mail…",
    confirmLabel: "Delete",
    isBusy: true
  }
}`,...a.parameters?.docs?.source},description:{story:`The account's Trash appointment has not resolved yet, so which of the two
dialogs above applies is not yet known. Rather than guess the reversible
wording over what may be an expunge, the copy stays neutral and the confirm
holds until the answer arrives.`,...a.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    title: "Can't delete 12 messages",
    description: "reader couldn't read this account's folder settings, so it can't say whether this would move the mail to Trash or erase it. Nothing has been deleted.",
    confirmLabel: "Sign in again",
    destructive: false
  }
}`,...o.parameters?.docs?.source},description:{story:`The read for those appointments failed rather than lagged, so there is no
answer coming and nothing to confirm. The dialog states the refusal and its
affirmative control is the way back in — never the delete, and never a button
that cannot be pressed (#855).`,...o.parameters?.docs?.description}}};const u=["Default","OneMessage","Busy","NonDestructive","PermanentDelete","OutcomeUnknown","OutcomeUnavailable"];export{t as Busy,e as Default,s as NonDestructive,n as OneMessage,o as OutcomeUnavailable,a as OutcomeUnknown,r as PermanentDelete,u as __namedExportsOrder,p as default};
