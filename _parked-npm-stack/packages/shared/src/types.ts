/**
 * Shared view/response DTO types (API -> web). These describe what the API returns, kept
 * separate from the Zod input schemas in schemas.ts. Monetary and effort values are carried
 * as `number` over the wire (serialised from Decimal) and formatted at display.
 */
import type {
  Role,
  Component,
  MenuCardStatus,
  EstimateStatus,
  AuditAction,
  ExportFormat,
} from './enums.js';

export interface UserView {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** The authenticated principal returned by /api/auth/me. */
export interface Principal {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface MenuCardVersionView {
  id: string;
  label: string;
  financialYear: string;
  sourceFilename: string;
  status: MenuCardStatus;
  blendedUspRate: number;
  overheadPct: number;
  peopleDayRate: number;
  uploadedByName: string;
  uploadedAt: string;
  variantCount: number;
}

/** The six stored Menu Card values, carried together wherever a variant/snapshot appears. */
export interface MenuCardValues {
  pd: number;
  usp: number;
  atom: number;
  uspCost: number;
  overheadCost: number;
  totalCost: number;
}

export interface ServiceVariantView extends MenuCardValues {
  id: string;
  menuCardVersionId: string;
  component: Component;
  size: string;
  changeCategory: string;
  description: string;
  scope: string | null;
  assumptions: string | null;
  exclusions: string | null;
  currentPartnerCost: string | null; // free text / range / "NA"
}

export interface EstimateLineView extends MenuCardValues {
  id: string;
  serviceVariantId: string;
  component: Component;
  size: string;
  description: string;
  quantity: number;
  notes: string | null;
  sortOrder: number;
  // computed line values = snapshot x quantity
  lineTotals: MenuCardValues;
}

export interface EstimateTotals {
  totalPd: number;
  totalUsp: number;
  totalAtom: number;
  totalUspCost: number;
  totalOverheadCost: number;
  grandTotalCost: number;
}

export interface EstimateView {
  id: string;
  estimateNumber: string;
  name: string;
  customerName: string;
  opportunityRef: string | null;
  description: string | null;
  version: number;
  status: EstimateStatus;
  menuCardVersionId: string;
  menuCardVersionLabel: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  lines: EstimateLineView[];
  totals: EstimateTotals;
}

/** Lightweight row for the repository list. */
export interface EstimateSummaryView {
  id: string;
  estimateNumber: string;
  name: string;
  customerName: string;
  status: EstimateStatus;
  grandTotalCost: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditEventView {
  id: string;
  userName: string | null;
  timestamp: string;
  action: AuditAction;
  objectType: string;
  objectId: string;
  detail: Record<string, unknown> | null;
}

export interface GeneratedDocumentView {
  id: string;
  estimateId: string;
  format: ExportFormat;
  fileName: string;
  generatedByName: string;
  generatedAt: string;
  sizeBytes: number;
}

// --- Dashboard payloads ---
export interface VolumeReport {
  created: number;
  approved: number;
  archived: number;
}

export interface ByProductReport {
  component: Component;
  estimateCount: number;
}

export interface ValueReport {
  totalEstimatedPd: number;
  totalEstimatedCost: number;
  byCustomer: { customerName: string; totalCost: number }[];
}

/** Standard API error shape. */
export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
