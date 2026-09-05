import{r as p,j as t}from"./iframe-uufGNBEn.js";import{u as h,J as f,Q as g,K as y}from"./react-query.gen-IGyAJPcH.js";import{Q as v}from"./queryClient-BRyi2MuU.js";import"./preload-helper-PPVm8Dsz.js";import"./client.gen-B9L6-vBr.js";const c=e=>({accountConfigId:"cfg-1",username:"alice@example.com",email:"alice@example.com",authType:"password",imapHost:"imap.example.com",imapPort:993,imapTls:!0,imapStartTls:!1,smtpEnabled:!0,smtpHost:"smtp.example.com",smtpPort:587,smtpTls:!1,smtpStartTls:!0,smtpUsername:"alice@example.com",isActive:!0,connectionState:"authenticated",createdAt:0,updatedAt:0,folderAppointments:[],...e}),b=(e,r={})=>({accountConfig:{accountConfigId:"cfg-1",userId:"user-1",state:"active",createdAt:0,updatedAt:0},accounts:e,semanticSearchEnabled:!0,...r}),u=({selectedAccountId:e,onSelect:r})=>{const{data:d}=h({...f(),staleTime:1/0}),a=d?.accounts??[];if(p.useEffect(()=>{!e&&a.length===1&&a[0]&&r(a[0])},[e,a,r]),a.length<=1){const n=a[0];return n?t.jsxs("div",{className:"flex items-start gap-2",children:[t.jsx("label",{className:"text-sm text-fg-muted shrink-0 w-12 pt-1.5",children:"From:"}),t.jsx("div",{className:"text-sm py-1.5",children:n.email})]}):null}const s=a.some(n=>n.accountId===e);return t.jsxs("div",{className:"flex items-start gap-2",children:[t.jsx("label",{htmlFor:"from-account-selector",className:"text-sm text-fg-muted shrink-0 w-12 pt-1.5",children:"From:"}),t.jsxs("select",{id:"from-account-selector",value:s?e:"",onChange:n=>{const l=a.find(m=>m.accountId===n.target.value);l&&r(l)},className:"flex-1 px-2 py-1.5 border rounded-md bg-canvas text-sm",children:[!s&&t.jsx("option",{value:"",disabled:!0,children:"Choose an account"}),a.map(n=>t.jsx("option",{value:n.accountId,children:n.email},n.accountId))]})]})};u.__docgenInfo={description:"",methods:[],displayName:"FromSelector",props:{selectedAccountId:{required:!1,tsType:{name:"string"},description:""},onSelect:{required:!0,tsType:{name:"signature",type:"function",raw:"(account: RemitImapAccountResponse) => void",signature:{arguments:[{type:{name:"signature",type:"object",raw:`{
    /**
     * Primary identifier
     */
    accountId: Uuid;
    /**
     * Reference to parent account configuration
     */
    accountConfigId: Uuid;
    /**
     * Login username
     */
    readonly username: string;
    /**
     * Primary email address
     */
    readonly email: string;
    /**
     * Authentication mechanism used by this account
     */
    authType: RemitImapAccountAuthType;
    /**
     * IMAP server hostname or IP address
     */
    readonly imapHost: string;
    /**
     * IMAP server port (typically 993 for TLS, 143 for STARTTLS)
     */
    readonly imapPort: number;
    /**
     * Whether to use TLS/SSL encryption (true for port 993)
     */
    readonly imapTls: boolean;
    /**
     * Whether to use STARTTLS upgrade (typically for port 143)
     */
    readonly imapStartTls: boolean;
    /**
     * Whether this account is configured to send mail over SMTP. The explicit marker for sending capability — never inferred from config-field presence.
     */
    readonly smtpEnabled: boolean;
    /**
     * SMTP server hostname or IP address for sending mail
     */
    readonly smtpHost: string;
    /**
     * SMTP server port (typically 587 for STARTTLS, 465 for TLS)
     */
    readonly smtpPort: number;
    /**
     * Whether to use TLS/SSL encryption for SMTP
     */
    readonly smtpTls: boolean;
    /**
     * Whether to use STARTTLS upgrade for SMTP
     */
    readonly smtpStartTls: boolean;
    /**
     * SMTP login username (may differ from IMAP username); empty when sending uses the IMAP username
     */
    readonly smtpUsername: string;
    /**
     * Whether the account is active and can login
     */
    readonly isActive: boolean;
    /**
     * Current connection state
     */
    connectionState: RemitImapConnectionState;
    /**
     * Timestamp of last successful connection
     */
    readonly lastConnectedAt?: number;
    /**
     * Timestamp of last synchronization attempt
     */
    readonly lastSyncAt?: number;
    /**
     * Error message from last failed connection attempt
     */
    readonly lastError?: string;
    /**
     * Current phase of the initial account sync lifecycle
     */
    syncPhase?: RemitImapSyncPhase;
    /**
     * Total number of mailboxes discovered during sync
     */
    readonly mailboxCountTotal?: number;
    /**
     * Number of mailboxes whose initial message sync has completed
     */
    readonly mailboxCountSynced?: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    /**
     * User-chosen display name for this account. Optional; when absent the UI derives a label from the email address. Sourced from a per-account AccountSetting row (RFC 032).
     */
    displayName?: string;
    /**
     * Account-level mute flag. When set, all mailboxes of this account are hidden from unified/brief views (sync is unaffected). Sourced from a per-account AccountSetting row (RFC 032).
     */
    muted?: RemitImapMutedFlag;
    /**
     * Plain text email signature for this account
     */
    signaturePlainText?: string;
    /**
     * HTML email signature for this account
     */
    signatureHtml?: string;
    /**
     * BCP 47 language tags this account writes mail in, most-used first (issue #686). The first entry is what a new message opens on; the whole list is the candidate set language detection chooses inside. Absent when the user has not configured one, and the client falls back to the browser's own languages. Sourced from a per-account AccountSetting row (RFC 032).
     */
    composeLanguages?: Array<string>;
    /**
     * Per-account appointment of each canonical role (Inbox, Drafts, Sent, Archive, Junk, Trash, All, Flagged) to at most one mailbox (RFC 032 exclusive-folder-appointment, issue #976). Always carries one entry per CanonicalMailboxRole member; an entry's \`mailboxId\` is a persisted user choice when set, or a server-proposed detection result when the user hasn't appointed that role yet. Write with PUT /accounts/{accountId}/folder-roles/{role}.
     */
    folderAppointments: Array<RemitImapFolderAppointment>;
}`,signature:{properties:[{key:"accountId",value:{name:"string",required:!1},description:"Primary identifier"},{key:"accountConfigId",value:{name:"string",required:!1},description:"Reference to parent account configuration"},{key:"username",value:{name:"string",required:!0},description:"Login username"},{key:"email",value:{name:"string",required:!0},description:"Primary email address"},{key:"authType",value:{name:"union",raw:"'password' | 'oauthMicrosoft'",elements:[{name:"literal",value:"'password'"},{name:"literal",value:"'oauthMicrosoft'"}],required:!0},description:"Authentication mechanism used by this account"},{key:"imapHost",value:{name:"string",required:!0},description:"IMAP server hostname or IP address"},{key:"imapPort",value:{name:"number",required:!0},description:"IMAP server port (typically 993 for TLS, 143 for STARTTLS)"},{key:"imapTls",value:{name:"boolean",required:!0},description:"Whether to use TLS/SSL encryption (true for port 993)"},{key:"imapStartTls",value:{name:"boolean",required:!0},description:"Whether to use STARTTLS upgrade (typically for port 143)"},{key:"smtpEnabled",value:{name:"boolean",required:!0},description:"Whether this account is configured to send mail over SMTP. The explicit marker for sending capability — never inferred from config-field presence."},{key:"smtpHost",value:{name:"string",required:!0},description:"SMTP server hostname or IP address for sending mail"},{key:"smtpPort",value:{name:"number",required:!0},description:"SMTP server port (typically 587 for STARTTLS, 465 for TLS)"},{key:"smtpTls",value:{name:"boolean",required:!0},description:"Whether to use TLS/SSL encryption for SMTP"},{key:"smtpStartTls",value:{name:"boolean",required:!0},description:"Whether to use STARTTLS upgrade for SMTP"},{key:"smtpUsername",value:{name:"string",required:!0},description:"SMTP login username (may differ from IMAP username); empty when sending uses the IMAP username"},{key:"isActive",value:{name:"boolean",required:!0},description:"Whether the account is active and can login"},{key:"connectionState",value:{name:"union",raw:"'not_authenticated' | 'authenticated' | 'selected' | 'logout' | 'reauth_required' | 'credentials_missing'",elements:[{name:"literal",value:"'not_authenticated'"},{name:"literal",value:"'authenticated'"},{name:"literal",value:"'selected'"},{name:"literal",value:"'logout'"},{name:"literal",value:"'reauth_required'"},{name:"literal",value:"'credentials_missing'"}],required:!0},description:"Current connection state"},{key:"lastConnectedAt",value:{name:"number",required:!1},description:"Timestamp of last successful connection"},{key:"lastSyncAt",value:{name:"number",required:!1},description:"Timestamp of last synchronization attempt"},{key:"lastError",value:{name:"string",required:!1},description:"Error message from last failed connection attempt"},{key:"syncPhase",value:{name:"union",raw:"'idle' | 'discovering_mailboxes' | 'syncing_inbox' | 'syncing_others' | 'complete' | 'error'",elements:[{name:"literal",value:"'idle'"},{name:"literal",value:"'discovering_mailboxes'"},{name:"literal",value:"'syncing_inbox'"},{name:"literal",value:"'syncing_others'"},{name:"literal",value:"'complete'"},{name:"literal",value:"'error'"}],required:!1},description:"Current phase of the initial account sync lifecycle"},{key:"mailboxCountTotal",value:{name:"number",required:!1},description:"Total number of mailboxes discovered during sync"},{key:"mailboxCountSynced",value:{name:"number",required:!1},description:"Number of mailboxes whose initial message sync has completed"},{key:"createdAt",value:{name:"number",required:!0}},{key:"updatedAt",value:{name:"number",required:!0}},{key:"displayName",value:{name:"string",required:!1},description:"User-chosen display name for this account. Optional; when absent the UI derives a label from the email address. Sourced from a per-account AccountSetting row (RFC 032)."},{key:"muted",value:{name:"intersection",raw:`RemitImapAddressFlagBase & {
    value: boolean;
}`,elements:[{name:"signature",type:"object",raw:`{
    /**
     * Timestamp when the flag was set
     */
    setAt: number;
    /**
     * Device/session/user identifier that set the flag (audit trail)
     */
    setBy?: string;
    /**
     * Optional auto-revoke timestamp
     */
    expiresAt?: number;
    /**
     * Free-text user note
     */
    reason?: string;
}`,signature:{properties:[{key:"setAt",value:{name:"number",required:!0},description:"Timestamp when the flag was set"},{key:"setBy",value:{name:"string",required:!1},description:"Device/session/user identifier that set the flag (audit trail)"},{key:"expiresAt",value:{name:"number",required:!1},description:"Optional auto-revoke timestamp"},{key:"reason",value:{name:"string",required:!1},description:"Free-text user note"}]}},{name:"signature",type:"object",raw:`{
    value: boolean;
}`,signature:{properties:[{key:"value",value:{name:"boolean",required:!0}}]}}],required:!1},description:"Account-level mute flag. When set, all mailboxes of this account are hidden from unified/brief views (sync is unaffected). Sourced from a per-account AccountSetting row (RFC 032)."},{key:"signaturePlainText",value:{name:"string",required:!1},description:"Plain text email signature for this account"},{key:"signatureHtml",value:{name:"string",required:!1},description:"HTML email signature for this account"},{key:"composeLanguages",value:{name:"Array",elements:[{name:"string"}],raw:"Array<string>",required:!1},description:"BCP 47 language tags this account writes mail in, most-used first (issue #686). The first entry is what a new message opens on; the whole list is the candidate set language detection chooses inside. Absent when the user has not configured one, and the client falls back to the browser's own languages. Sourced from a per-account AccountSetting row (RFC 032)."},{key:"folderAppointments",value:{name:"Array",elements:[{name:"signature",type:"object",raw:`{
    /**
     * Which canonical role this entry fills.
     */
    role: RemitImapCanonicalMailboxRole;
    /**
     * Where \`mailboxId\` came from. Read this rather than inferring provenance from the shape of the entry: only \`Appointed\` means a person decided, and only \`Appointed\` and \`Flagged\` are evidence strong enough to destroy mail with.
     */
    source: RemitImapFolderAppointmentSource;
    /**
     * The mailbox this role resolves to. Absent when resolution names none — \`source: None\`, or a \`Stale\` appointment with nothing to fall back to.
     */
    mailboxId?: Uuid;
    /**
     * The mailbox the user appointed, when the account no longer holds it. Present exactly when \`source\` is \`Stale\`; the appointment is kept rather than collected, so the user can repair it instead of silently losing the choice.
     */
    staleAppointmentMailboxId?: Uuid;
    /**
     * The path that stale mailbox last had, recorded beside the appointment when it was made. Display only — resolution never reads it — and present only alongside \`staleAppointmentMailboxId\`, and only for an appointment made after the path was first recorded.
     */
    staleAppointmentPath?: String512;
}`,signature:{properties:[{key:"role",value:{name:"union",raw:"'Inbox' | 'Drafts' | 'Sent' | 'Archive' | 'Junk' | 'Trash' | 'All' | 'Flagged'",elements:[{name:"literal",value:"'Inbox'"},{name:"literal",value:"'Drafts'"},{name:"literal",value:"'Sent'"},{name:"literal",value:"'Archive'"},{name:"literal",value:"'Junk'"},{name:"literal",value:"'Trash'"},{name:"literal",value:"'All'"},{name:"literal",value:"'Flagged'"}],required:!0},description:"Which canonical role this entry fills."},{key:"source",value:{name:"union",raw:"'Appointed' | 'Flagged' | 'Reserved' | 'Proposed' | 'Stale' | 'None'",elements:[{name:"literal",value:"'Appointed'"},{name:"literal",value:"'Flagged'"},{name:"literal",value:"'Reserved'"},{name:"literal",value:"'Proposed'"},{name:"literal",value:"'Stale'"},{name:"literal",value:"'None'"}],required:!0},description:"Where `mailboxId` came from. Read this rather than inferring provenance from the shape of the entry: only `Appointed` means a person decided, and only `Appointed` and `Flagged` are evidence strong enough to destroy mail with."},{key:"mailboxId",value:{name:"string",required:!1},description:"The mailbox this role resolves to. Absent when resolution names none — `source: None`, or a `Stale` appointment with nothing to fall back to."},{key:"staleAppointmentMailboxId",value:{name:"string",required:!1},description:"The mailbox the user appointed, when the account no longer holds it. Present exactly when `source` is `Stale`; the appointment is kept rather than collected, so the user can repair it instead of silently losing the choice."},{key:"staleAppointmentPath",value:{name:"string",required:!1},description:"The path that stale mailbox last had, recorded beside the appointment when it was made. Display only — resolution never reads it — and present only alongside `staleAppointmentMailboxId`, and only for an appointment made after the path was first recorded."}]}}],raw:"Array<RemitImapFolderAppointment>",required:!0},description:"Per-account appointment of each canonical role (Inbox, Drafts, Sent, Archive, Junk, Trash, All, Flagged) to at most one mailbox (RFC 032 exclusive-folder-appointment, issue #976). Always carries one entry per CanonicalMailboxRole member; an entry's `mailboxId` is a persisted user choice when set, or a server-proposed detection result when the user hasn't appointed that role yet. Write with PUT /accounts/{accountId}/folder-roles/{role}."}]}},name:"account"}],return:{name:"void"}}},description:""}}};const T=[c({accountId:"acc-1",email:"alice@example.com"}),c({accountId:"acc-2",email:"bob@example.com"})];function A(){const e=new v({defaultOptions:{queries:{retry:!1},mutations:{retry:!1}}});return e.setQueryData(y(),b(T)),e}const P={title:"Components/FromSelector",component:u,parameters:{layout:"padded"},decorators:[e=>t.jsx(g,{client:A(),children:t.jsx(e,{})})],args:{onSelect:()=>{}}},o={args:{selectedAccountId:"acc-2"}},i={args:{selectedAccountId:void 0}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    selectedAccountId: "acc-2"
  }
}`,...o.parameters?.docs?.source},description:{story:"A resolved account, picked from the configured accounts.",...o.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    selectedAccountId: undefined
  }
}`,...i.parameters?.docs?.source},description:{story:`No account resolved — the source mailbox could not be matched to a
configured account. The select shows a disabled placeholder instead of
falling back to the first account's address.`,...i.parameters?.docs?.description}}};const q=["Resolved","Unresolved"];export{o as Resolved,i as Unresolved,q as __namedExportsOrder,P as default};
