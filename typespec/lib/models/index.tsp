// Account Layer
import "./Account.tsp";
import "./AccountSetting.tsp";
import "./FolderAppointment.tsp";
import "./Mailbox.tsp";
import "./MailboxLock.tsp";

// Message Layer
import "./Message.tsp";
import "./MessagePlacementMove.tsp";
import "./Quarantine.tsp";
import "./MessageFlagPush.tsp";

// Envelope Layer (RFC 2822)
import "./Envelope.tsp";
import "./Address.tsp";

// Sender authenticity
import "./SenderSignerStanding.tsp";

// Body Structure Layer (MIME)
import "./BodyPart.tsp";

// Storage Layer
import "./Storage.tsp";

// Thread Layer
import "./ThreadMessage.tsp";

// Outbox Layer (SMTP)
import "./OutboxMessage.tsp";
import "./OutboxAttachment.tsp";

// Semantic Search
import "./SemanticSearch.tsp";

// Export
import "./AccountExportRequest.tsp";

// Configuration import (#1021)
import "./ConfigImport.tsp";

// Smart Organize back-apply job (RFC 034, #1278)
import "./OrganizeJobRequest.tsp";

// Standalone self-update (RFC 037)
import "./SystemUpdate.tsp";

// Calendar Layer (iCalendar RFC 5545, CalDAV RFC 4791, issue #15)
import "./CalendarCollection.tsp";
import "./CalendarObject.tsp";
import "./CalendarEventIndex.tsp";

// Smart Organize (RFC 030, RFC 034)
import "./Label.tsp";
import "./MessageLabel.tsp";
import "./Filter.tsp";
import "./FilterAnchor.tsp";
