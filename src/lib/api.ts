import { auth } from '../firebase';

// Keep custom non-Firebase session token strictly in JS memory (never localStorage/sessionStorage).
let inMemorySessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  inMemorySessionToken = token && token.trim() ? token.trim() : null;
}

export function getSessionToken(): string | null {
  return inMemorySessionToken;
}

export async function getBearerToken(): Promise<string | null> {
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) return idToken;
    } catch {
      // Fall back to in-memory server session token if available
    }
  }
  return inMemorySessionToken;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getBearerToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}

export async function buildAuthorizedDocumentUrl(
  documentId: string,
  download: boolean = false
): Promise<string> {
  const token = await getBearerToken();
  const params = new URLSearchParams();
  if (download) params.set('download', '1');
  if (token) params.set('token', token);
  const qs = params.toString();
  return `/api/documents/${encodeURIComponent(documentId)}/file${qs ? `?${qs}` : ''}`;
}
