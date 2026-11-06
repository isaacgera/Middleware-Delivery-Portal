/**
 * Shared constants — single source of truth for roles, components, statuses, audit actions.
 * Plain ES module, used by the server. (The dependency-free equivalent of @mdp/shared.)
 */

export const Role = {
  DELIVERY_MANAGER: 'DELIVERY_MANAGER',
  ADMINISTRATOR: 'ADMINISTRATOR',
};

export const Component = {
  MQ: 'MQ',
  WLS: 'WLS',
  CFT: 'CFT',
  WILDFLY: 'WILDFLY',
};

export const ComponentLabel = {
  MQ: 'IBM MQ',
  WLS: 'Oracle WebLogic',
  CFT: 'Axway CFT',
  WILDFLY: 'WildFly',
};

/** Worksheet-name -> Component enum mapping for the Menu Card importer. */
export const WorksheetToComponent = {
  MQ: Component.MQ,
  Weblogic: Component.WLS,
  CFT: Component.CFT,
  WildFly: Component.WILDFLY,
};

export const NonComponentSheets = ['Version', 'Variables'];

export const MenuCardStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
};

/**
 * Request status workflow: New (default) → Pending → Approved → In Progress → Done.
 * Any-to-any transitions are allowed (no guard), and a request is editable in every status.
 *
 * ARCHIVED (Stage 6) is a separate state, not part of the active workflow line: it is reached
 * via the explicit Archive action and left by moving back to any active status (un-archive).
 * Archived requests are hidden from the default Requests list but remain searchable via the
 * status filter. (A 12-month auto-archive rule is planned for a later pass.)
 */
export const EstimateStatus = {
  NEW: 'NEW',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  ARCHIVED: 'ARCHIVED',
  CANCELLED: 'CANCELLED',
};

export const EstimateStatusDefault = EstimateStatus.NEW;

/** The active-workflow statuses (everything except ARCHIVED) — the dropdown + default list set. */
export const EstimateActiveStatuses = [
  EstimateStatus.NEW,
  EstimateStatus.PENDING,
  EstimateStatus.APPROVED,
  EstimateStatus.IN_PROGRESS,
  EstimateStatus.DONE,
];

/**
 * Terminal statuses that can't be moved to CANCELLED (a request that's finished or filed can't
 * be cancelled). CANCELLED itself is "soft-terminal": reachable from any active status, and a
 * cancelled request can be revived back to an active status — but never straight to DONE/ARCHIVED.
 */
export const EstimateTerminalStatuses = [EstimateStatus.DONE, EstimateStatus.ARCHIVED];

export const EstimateStatusLabel = {
  NEW: 'New',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
  CANCELLED: 'Cancelled',
};

/**
 * Maps legacy status values (from before this workflow) onto the new set, for migration.
 */
export const LegacyStatusMap = {
  DRAFT: 'NEW',
  UNDER_REVIEW: 'PENDING',
  APPROVED: 'APPROVED',
  ARCHIVED: 'DONE',
};

/**
 * Customer Facing Units (CFU) — the BT business units a request belongs to.
 * Alphabetical order (used directly to populate the dropdown).
 */
export const CFU = [
  'Architecture',
  'Business',
  'Consumer',
  'Corporate',
  'Data & AI',
  'International',
  'Networks',
  'Openreach',
];

/** T-shirt size ladder (superset; actual options per component are still data-driven). */
export const SIZES = ['TO', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** Internal request reference prefix (backend primary identifier; never user-facing). */
export const REQUEST_REF_PREFIX = 'MDP-';

export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  MENUCARD_UPLOAD: 'MENUCARD_UPLOAD',
  MENUCARD_ACTIVATION: 'MENUCARD_ACTIVATION',
  ESTIMATE_CREATE: 'ESTIMATE_CREATE',
  ESTIMATE_MODIFY: 'ESTIMATE_MODIFY',
  ESTIMATE_DELETE: 'ESTIMATE_DELETE',
  ESTIMATE_EXPORT: 'ESTIMATE_EXPORT',
};

export const ExportFormat = { PDF: 'PDF' };

export const APP_VERSION = '0.1.0-proto';
