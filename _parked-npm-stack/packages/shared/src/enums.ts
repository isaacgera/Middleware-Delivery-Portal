/**
 * Shared enums — the single source of truth for roles, statuses, components and audit actions.
 * Used by both the API and the web app. Kept as `as const` objects + union types so they are
 * usable as runtime values and compile-time types.
 */

// --- User roles (Phase 1: two roles; Administrator is a superset of Delivery Manager) ---
export const Role = {
  DELIVERY_MANAGER: 'DELIVERY_MANAGER',
  ADMINISTRATOR: 'ADMINISTRATOR',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

// --- Middleware components (= products). Worksheet "Weblogic" maps to WLS. ---
export const Component = {
  MQ: 'MQ',
  WLS: 'WLS',
  CFT: 'CFT',
  WILDFLY: 'WILDFLY',
} as const;
export type Component = (typeof Component)[keyof typeof Component];

/** Display labels for components (UI). */
export const ComponentLabel: Record<Component, string> = {
  MQ: 'IBM MQ',
  WLS: 'Oracle WebLogic',
  CFT: 'Axway CFT',
  WILDFLY: 'WildFly',
};

/** Worksheet-name -> Component enum mapping for the Menu Card importer (design §5). */
export const WorksheetToComponent: Record<string, Component> = {
  MQ: Component.MQ,
  Weblogic: Component.WLS,
  CFT: Component.CFT,
  WildFly: Component.WILDFLY,
};

/** Non-component worksheets the importer handles explicitly (not treated as products). */
export const NonComponentSheets = ['Version', 'Variables'] as const;

// --- Menu Card version lifecycle ---
export const MenuCardStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type MenuCardStatus = (typeof MenuCardStatus)[keyof typeof MenuCardStatus];

// --- Estimate lifecycle ---
export const EstimateStatus = {
  DRAFT: 'DRAFT',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type EstimateStatus = (typeof EstimateStatus)[keyof typeof EstimateStatus];

/** Allowed estimate status transitions (guarded in the API). */
export const EstimateStatusTransitions: Record<EstimateStatus, EstimateStatus[]> = {
  DRAFT: ['UNDER_REVIEW', 'ARCHIVED'],
  UNDER_REVIEW: ['DRAFT', 'APPROVED', 'ARCHIVED'],
  APPROVED: ['ARCHIVED'],
  ARCHIVED: [],
};

// --- Audit events (append-only) ---
export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  MENUCARD_UPLOAD: 'MENUCARD_UPLOAD',
  MENUCARD_ACTIVATION: 'MENUCARD_ACTIVATION',
  ESTIMATE_CREATE: 'ESTIMATE_CREATE',
  ESTIMATE_MODIFY: 'ESTIMATE_MODIFY',
  ESTIMATE_DELETE: 'ESTIMATE_DELETE', // line deletion; estimates are archived, not hard-deleted
  ESTIMATE_EXPORT: 'ESTIMATE_EXPORT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

// --- Export formats (Phase 1: PDF only) ---
export const ExportFormat = {
  PDF: 'PDF',
} as const;
export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

/** Fixed prefix for estimate numbers (ARCH-XXXX). */
export const ESTIMATE_NUMBER_PREFIX = 'ARCH-';
