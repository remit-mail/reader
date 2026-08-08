import{j as e,r as h}from"./iframe-uTafckjr.js";import{B as p}from"./button-DCXIHjmE.js";import{F as m}from"./field-label-BWGL_4sB.js";import{I as u}from"./input-KNBszVtY.js";import{S as a}from"./slide-panel-SWF6W5AE.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./x-DS_pud-s.js";import"./createLucideIcon-DLYy-DY-.js";const B={title:"Components/SlidePanel",component:a,parameters:{layout:"fullscreen"}},x=Array.from({length:12},(n,d)=>`Row ${d+1}`),l=()=>e.jsxs("div",{className:"h-dvh space-y-3 bg-canvas p-6",children:[e.jsx("h1",{className:"text-md font-semibold text-fg",children:"Screen behind the panel"}),x.map(n=>e.jsx("div",{className:"rounded-sm border border-line bg-surface px-4 py-3 text-sm text-fg-muted",children:n},n))]}),i=()=>e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{children:[e.jsx(m,{htmlFor:"slide-panel-email",children:"Email address"}),e.jsx(u,{id:"slide-panel-email",placeholder:"alice@example.com"})]}),e.jsxs("div",{children:[e.jsx(m,{htmlFor:"slide-panel-name",children:"Display name"}),e.jsx(u,{id:"slide-panel-name",placeholder:"Alice"})]})]}),v=({onClose:n})=>e.jsxs(e.Fragment,{children:[e.jsx(p,{variant:"secondary",size:"sm",onClick:n,children:"Cancel"}),e.jsx(p,{variant:"primary",size:"sm",children:"Save"})]}),s={globals:{viewport:{value:"desktop"}},render:()=>e.jsxs(e.Fragment,{children:[e.jsx(l,{}),e.jsx(a,{isOpen:!0,onClose:()=>{},title:"Add Account",footer:null,children:e.jsx(i,{})})]})},o={globals:{viewport:{value:"desktop"}},render:()=>e.jsxs(e.Fragment,{children:[e.jsx(l,{}),e.jsx(a,{isOpen:!1,onClose:()=>{},title:"Add Account",footer:null,children:e.jsx(i,{})})]})},r={globals:{viewport:{value:"mobile"}},render:()=>e.jsxs(e.Fragment,{children:[e.jsx(l,{}),e.jsx(a,{isOpen:!0,onClose:()=>{},title:"Add Account",footer:null,children:e.jsx(i,{})})]})},t={globals:{viewport:{value:"desktop"}},render:function(){const[d,c]=h.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"h-dvh space-y-3 bg-canvas p-6",children:[e.jsx(p,{variant:"primary",size:"sm",onClick:()=>c(!0),children:"Add account"}),e.jsx(l,{})]}),e.jsx(a,{isOpen:d,onClose:()=>c(!1),title:"Add Account",footer:e.jsx(v,{onClose:()=>c(!1)}),children:e.jsx(i,{})})]})}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  globals: {
    viewport: {
      value: "desktop"
    }
  },
  render: () => <>
            <Backdrop />
            <SlidePanel isOpen onClose={() => {}} title="Add Account" footer={null}>
                <Body />
            </SlidePanel>
        </>
}`,...s.parameters?.docs?.source},description:{story:"Open: a fixed-width column at the right edge, the screen behind it dimmed.",...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  globals: {
    viewport: {
      value: "desktop"
    }
  },
  render: () => <>
            <Backdrop />
            <SlidePanel isOpen={false} onClose={() => {}} title="Add Account" footer={null}>
                <Body />
            </SlidePanel>
        </>
}`,...o.parameters?.docs?.source},description:{story:`Closed. The panel stays mounted so it can animate, so this is the state that
has to be provably invisible: a closed panel that is not pushed off-canvas
takes over the whole screen (#57).`,...o.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <>
            <Backdrop />
            <SlidePanel isOpen onClose={() => {}} title="Add Account" footer={null}>
                <Body />
            </SlidePanel>
        </>
}`,...r.parameters?.docs?.source},description:{story:"On a phone the panel owns the full width.",...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  globals: {
    viewport: {
      value: "desktop"
    }
  },
  render: function Render() {
    const [open, setOpen] = useState(false);
    return <>
                <div className="h-dvh space-y-3 bg-canvas p-6">
                    <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                        Add account
                    </Button>
                    <Backdrop />
                </div>
                <SlidePanel isOpen={open} onClose={() => setOpen(false)} title="Add Account" footer={<Footer onClose={() => setOpen(false)} />}>
                    <Body />
                </SlidePanel>
            </>;
  }
}`,...t.parameters?.docs?.source},description:{story:"Opening and closing from the screen behind it.",...t.parameters?.docs?.description}}};const w=["Open","Closed","Phone","Interactive"];export{o as Closed,t as Interactive,s as Open,r as Phone,w as __namedExportsOrder,B as default};
