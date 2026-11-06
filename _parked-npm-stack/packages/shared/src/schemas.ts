/**
 * Shared Zod schemas + inferred DTO types. Single source of truth for input shapes,
 * validated identically on the API and surfaced as types on the web app.
 */
import { z } from 'zod';
import {
  Role,
  Component,
  MenuCardStatus,
  EstimateStatus,
  ExportFormat,
  ESTIMATE_NUMBER_PREFIX,
} from './enums.js';

// --- Reusable primitives ---
const zRole = z.enum([Role.DELIVERY_MANAGER, Role.ADMINISTRATOR]);
const zComponent = z.enum([Component.MQ, Component.WLS, Component.CFT, Component.WILDFLY]);
const zEstimateStatus = z.enum([
  EstimateStatus.DRAFT,
  EstimateStatus.UNDER_REVIEW,
  EstimateStatus.APPROVED,
  EstimateStatus.ARCHIVED,
]);

/** Estimate number: fixed prefix ARCH- then digits (XXXX, editable by DM/Admin). */
export const estimateNumberSchema = z
  .string()
  .regex(
    new RegExp(`^${ESTIMATE_NUMBER_PREFIX}\\d{3,}$`),
    'Estimate number must look like ARCH-0001',
  );

// --- Auth ---
export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// --- Users (admin) ---
export const createUserSchema = z.object({
  username: z.string().min(3).max(64),
  displayName: z.string().min(1).max(128),
  email: z.string().email().optional(),
  role: zRole,
  password: z.string().min(8),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  email: z.string().email().optional(),
  role: zRole.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// --- Estimate header ---
export const createEstimateSchema = z.object({
  // estimateNumber optional on create: server auto-suggests next ARCH-XXXX if omitted
  estimateNumber: estimateNumberSchema.optional(),
  name: z.string().min(1, 'Estimate name is required').max(200),
  customerName: z.string().min(1, 'Customer name is required').max(200),
  opportunityRef: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
});
export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;

export const updateEstimateSchema = z.object({
  estimateNumber: estimateNumberSchema.optional(),
  name: z.string().min(1).max(200).optional(),
  customerName: z.string().min(1).max(200).optional(),
  opportunityRef: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  status: zEstimateStatus.optional(),
  // optimistic concurrency: client must echo the rowVersion it last read
  rowVersion: z.number().int().nonnegative(),
});
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;

// --- Estimate lines ---
export const createLineSchema = z.object({
  serviceVariantId: z.string().min(1),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  notes: z.string().max(1000).optional(),
});
export type CreateLineInput = z.infer<typeof createLineSchema>;

export const updateLineSchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdateLineInput = z.infer<typeof updateLineSchema>;

// --- Catalogue / repository query filters ---
export const catalogueQuerySchema = z.object({
  component: zComponent.optional(),
  size: z.string().optional(),
  q: z.string().optional(),
});
export type CatalogueQuery = z.infer<typeof catalogueQuerySchema>;

export const estimateQuerySchema = z.object({
  number: z.string().optional(),
  customer: z.string().optional(),
  component: zComponent.optional(),
  status: zEstimateStatus.optional(),
  createdBy: z.string().optional(),
  from: z.string().optional(), // ISO date
  to: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type EstimateQuery = z.infer<typeof estimateQuerySchema>;

// --- Export ---
export const exportRequestSchema = z.object({
  format: z.enum([ExportFormat.PDF]).default(ExportFormat.PDF),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;
