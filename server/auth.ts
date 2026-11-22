import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { UserAccount, UserRole, getPrimaryRole, getUserRoles } from '../src/types/printhaus';
import { verifyFirebaseBearerToken } from './firebaseAdmin';
import { getDb, saveDatabase } from './store';

export interface AuthenticatedRequest extends Request {
  authUser?: UserAccount;
  authProvider?: 'session' | 'firebase';
}

const SESSION_PREFIX = 'phs1.';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  const configured = process.env.AUTH_TOKEN_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_FALLBACK_SECRET;
}

export function issueSessionToken(userId: string): string {
  const payloadObj = {
    uid: userId,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${SESSION_PREFIX}${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string): { uid: string } | null {
  if (!token.startsWith(SESSION_PREFIX)) return null;
  const rest = token.slice(SESSION_PREFIX.length);
  const parts = rest.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length === 0 || sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      uid?: string;
      exp?: number;
    };
    if (!parsed.uid || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return { uid: parsed.uid };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  return queryToken || null;
}

function findOrProvisionFirebaseUser(
  uid: string,
  email: string,
  displayName?: string
): UserAccount {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const byUid = db.users.find((u) => u.id === uid);
  if (byUid) {
    byUid.roles = getUserRoles(byUid);
    byUid.role = getPrimaryRole(byUid.roles);
    return byUid;
  }

  const byEmail = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (byEmail) {
    // Link pre-created / admin-assigned staff or student account to the verified Firebase UID
    const previousId = byEmail.id;
    byEmail.id = uid;
    byEmail.roles = getUserRoles(byEmail);
    byEmail.role = getPrimaryRole(byEmail.roles);
    if (displayName && !byEmail.name) {
      byEmail.name = displayName.trim();
    }
    for (const order of db.orders) {
      if (order.studentId === previousId) order.studentId = uid;
    }
    for (const ntf of db.notifications) {
      if (ntf.userId === previousId) ntf.userId = uid;
    }
    for (const cmp of db.complaints) {
      if (cmp.studentId === previousId) cmp.studentId = uid;
    }
    saveDatabase();
    return byEmail;
  }

  // Brand-new Firebase user: strictly student role only unless matched above
  const isBootstrappedAdmin = normalizedEmail === 'chukwuemekaodoemene@gmail.com';
  const roles: UserRole[] = isBootstrappedAdmin ? ['admin', 'student'] : ['student'];
  const newUser: UserAccount = {
    id: uid,
    name: (displayName || normalizedEmail.split('@')[0] || 'PAU User').trim(),
    email: normalizedEmail,
    matricNumber: 'PAU-NEW',
    school: 'School of Science and Technology',
    department: 'Computer Science',
    residency: 'off-campus',
    role: getPrimaryRole(roles),
    roles,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  db.users.push(newUser);
  saveDatabase();
  return newUser;
}

export async function authenticateRequest(req: Request): Promise<{
  user: UserAccount;
  provider: 'session' | 'firebase';
} | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const sessionPayload = verifySessionToken(token);
  if (sessionPayload) {
    const db = getDb();
    const user = db.users.find((u) => u.id === sessionPayload.uid);
    if (!user) return null;
    user.roles = getUserRoles(user);
    user.role = getPrimaryRole(user.roles);
    return { user, provider: 'session' };
  }

  try {
    const decoded = await verifyFirebaseBearerToken(token);
    const email = (decoded.email || '').trim().toLowerCase();
    if (!decoded.uid || !email) return null;
    const user = findOrProvisionFirebaseUser(decoded.uid, email, decoded.name);
    return { user, provider: 'firebase' };
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const result = await authenticateRequest(req);
  if (!result) {
    res.status(401).json({ error: 'Authentication required. Please sign in again.' });
    return;
  }

  if (result.user.status === 'suspended') {
    res.status(403).json({ error: 'Your account has been deactivated or suspended. Contact PrintHaus Admin.' });
    return;
  }

  req.authUser = result.user;
  req.authProvider = result.provider;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const userRoles = getUserRoles(user);
    const hasAccess = allowedRoles.some((r) => userRoles.includes(r));
    if (!hasAccess) {
      res.status(403).json({
        error: `Forbidden: requires ${allowedRoles.join(' or ')} permission.`,
      });
      return;
    }

    next();
  };
}
