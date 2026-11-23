import { auth } from '../services/firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  const serialized = JSON.stringify(errInfo);
  console.error('Firestore Error: ', serialized);
  throw new Error(serialized);
}

export function formatFriendlyFirestoreError(
  err: unknown,
  fallback = 'Operation failed.',
  diagnosticCode?: string
): string {
  const isDev = typeof import.meta !== 'undefined' && Boolean((import.meta as any).env?.DEV);
  const codePrefix = isDev && diagnosticCode ? `[${diagnosticCode}] ` : '';
  const raw = err instanceof Error ? err.message : String(err || '');

  try {
    const parsed = JSON.parse(raw) as FirestoreErrorInfo;
    if (parsed && typeof parsed.error === 'string') {
      if (
        parsed.error.toLowerCase().includes('missing or insufficient permissions') ||
        parsed.error.includes('permission-denied')
      ) {
        if (isDev) {
          return `${codePrefix}Permission denied during ${parsed.operationType} on ${parsed.path || 'record'}. Verify active school membership, class/subject assignment, and report lock status.`;
        }
        return `Unable to ${fallback}. You do not have permission for this school, class, subject, or locked report.`;
      }
      return `${codePrefix}${parsed.error}`;
    }
  } catch {
    // Non-JSON error message
  }

  if (raw.toLowerCase().includes('missing or insufficient permissions') || raw.includes('permission-denied')) {
    if (isDev) {
      return `${codePrefix}Missing or insufficient permissions. Please verify your active school membership, class/subject authorization, and report lock status.`;
    }
    return `Unable to ${fallback}. Please check that you are assigned to this class and subject, and that the report has not been locked.`;
  }

  return raw ? `${codePrefix}${raw}` : fallback;
}
