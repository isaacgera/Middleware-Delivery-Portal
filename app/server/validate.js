/**
 * Tiny validation helpers (dependency-free replacement for Zod). Each returns the cleaned
 * value or throws badRequest with a clear message. Kept minimal and explicit.
 */
import { badRequest } from './http-util.js';

export function requireString(obj, field, { min = 1, max = 100000, trim = true, label } = {}) {
  const name = label || field;
  let v = obj?.[field];
  if (typeof v !== 'string' || (trim ? v.trim() : v).length === 0) throw badRequest(`${name} is required`);
  if (trim) v = v.trim();
  if (v.length < min) throw badRequest(`${name} must be at least ${min} character(s)`);
  if (v.length > max) throw badRequest(`${name} must be at most ${max} characters`);
  return v;
}

export function optionalString(obj, field, { max = 100000, trim = true, label } = {}) {
  const name = label || field;
  let v = obj?.[field];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw badRequest(`${name} must be a string`);
  if (trim) v = v.trim();
  if (v.length > max) throw badRequest(`${name} must be at most ${max} characters`);
  return v;
}

export function requireEnum(obj, field, allowed) {
  const v = obj?.[field];
  if (!allowed.includes(v)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return v;
}

export function optionalBoolean(obj, field) {
  const v = obj?.[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw badRequest(`${field} must be a boolean`);
  return v;
}

export function requireNumber(obj, field, { min, max, positive } = {}) {
  const raw = obj?.[field];
  const v = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof v !== 'number' || Number.isNaN(v)) throw badRequest(`${field} must be a number`);
  if (positive && v <= 0) throw badRequest(`${field} must be greater than zero`);
  if (min !== undefined && v < min) throw badRequest(`${field} must be >= ${min}`);
  if (max !== undefined && v > max) throw badRequest(`${field} must be <= ${max}`);
  return v;
}
