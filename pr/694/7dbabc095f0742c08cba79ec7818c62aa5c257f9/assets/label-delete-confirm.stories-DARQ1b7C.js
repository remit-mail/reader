import{C as c}from"./ConfirmDialog-CsMqqNSl.js";import"./iframe-uTafckjr.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BLNPqUX_.js";import"./bundle-mjs-DeRmtv56.js";const o=(a,i)=>{if(i===0)return{title:`Delete the "${a}" label?`};const l=i===1?"filter":"filters";return{title:`Delete the "${a}" label?`,description:`This also deletes ${i} ${l} that ${i===1?"applies":"apply"} it — they can't be recovered.`}},b={title:"Flows/Settings Labels/Delete Confirmation",component:c,parameters:{layout:"centered",docs:{description:{component:"The cascade-aware label delete confirmation (issue #26, #335) — the generic\n`ConfirmDialog` driven by `deleteLabelConfirmCopy`'s computed title and\ndescription, exactly as `AccountLabels` in the labels settings route wires\nit. No dedicated component exists for this; reusing `ConfirmDialog` is the\napproved surface, not a placeholder for one."}}}},e={args:{isOpen:!0,...o("Receipts",0),confirmLabel:"Delete label",destructive:!0,onConfirm:()=>{},onCancel:()=>{}}},r={args:{isOpen:!0,...o("Receipts",1),confirmLabel:"Delete label",destructive:!0,onConfirm:()=>{},onCancel:()=>{}}},n={args:{isOpen:!0,...o("Receipts",5),confirmLabel:"Delete label",destructive:!0,onConfirm:()=>{},onCancel:()=>{}}},t={name:"Several Filters (dark)",parameters:{theme:"dark"},args:{isOpen:!0,...o("Receipts",5),confirmLabel:"Delete label",destructive:!0,onConfirm:()=>{},onCancel:()=>{}}},s={args:{isOpen:!0,...o("Receipts",5),confirmLabel:"Delete label",destructive:!0,isBusy:!0,onConfirm:()=>{},onCancel:()=>{}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    isOpen: true,
    ...deleteLabelConfirmCopy("Receipts", 0),
    confirmLabel: "Delete label",
    destructive: true,
    onConfirm: () => undefined,
    onCancel: () => undefined
  }
}`,...e.parameters?.docs?.source},description:{story:"Nothing references the label — no blast-radius line under the title.",...e.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    isOpen: true,
    ...deleteLabelConfirmCopy("Receipts", 1),
    confirmLabel: "Delete label",
    destructive: true,
    onConfirm: () => undefined,
    onCancel: () => undefined
  }
}`,...r.parameters?.docs?.source},description:{story:"Exactly one filter applies the label — singular wording.",...r.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    isOpen: true,
    ...deleteLabelConfirmCopy("Receipts", 5),
    confirmLabel: "Delete label",
    destructive: true,
    onConfirm: () => undefined,
    onCancel: () => undefined
  }
}`,...n.parameters?.docs?.source},description:{story:"Several filters apply the label — the cascade warning names the count.",...n.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Several Filters (dark)",
  parameters: {
    theme: "dark"
  },
  args: {
    isOpen: true,
    ...deleteLabelConfirmCopy("Receipts", 5),
    confirmLabel: "Delete label",
    destructive: true,
    onConfirm: () => undefined,
    onCancel: () => undefined
  }
}`,...t.parameters?.docs?.source},description:{story:"Several filters, on the dark theme.",...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    isOpen: true,
    ...deleteLabelConfirmCopy("Receipts", 5),
    confirmLabel: "Delete label",
    destructive: true,
    isBusy: true,
    onConfirm: () => undefined,
    onCancel: () => undefined
  }
}`,...s.parameters?.docs?.source},description:{story:`The delete is in flight — confirm disables rather than allowing a second
 concurrent delete.`,...s.parameters?.docs?.description}}};const C=["Unused","OneFilter","SeveralFilters","SeveralFiltersDark","Busy"];export{s as Busy,r as OneFilter,n as SeveralFilters,t as SeveralFiltersDark,e as Unused,C as __namedExportsOrder,b as default};
