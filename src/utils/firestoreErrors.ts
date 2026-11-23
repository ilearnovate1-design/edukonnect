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

export function formatFriendlyFirestoreError(err: unknown, fallback = 'Operation failed.'): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  try {
    const parsed = JSON.parse(raw) as FirestoreErrorInfo;
    if (parsed && typeof parsed.error === 'string') {
      if (parsed.error.toLowerCase().includes('missing or insufficient permissions') || parsed.error.includes('permission-denied')) {
        return `Missing or insufficient permissions for ${parsed.operationType} on ${parsed.path || 'record'}. Verify your school membership, class/subject assignment, or report status.`;
      }
      return parsed.error;
    }
  } catch {
    // Non-JSON error message
  }
  if (raw.toLowerCase().includes('missing or insufficient permissions') || raw.includes('permission-denied')) {
    return 'Missing or insufficient permissions. Please verify your active school membership, class/subject authorization, and report lock status.';
  }
  return raw || fallback;
}
