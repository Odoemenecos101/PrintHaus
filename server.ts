import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
import {
  AuthenticatedRequest,
  issueSessionToken,
  requireAuth,
  requireRole,
} from './server/auth';
import { verifyFirebaseBearerToken } from './server/firebaseAdmin';
import {
  generateOrderCodes,
  getDb,
  getStatusLabel,
  getUploadsDir,
  hashPasswordScrypt,
  initDatabase,
  saveDatabase,
  verifyPassword,
} from './server/store';
import {
  BindingOption,
  CollectionHistoryEntry,
  CollectionRecord,
  ColorMode,
  OrderDocumentItemInput,
  OrderStatus,
  PaymentMethod,
  PrintOrder,
  SidedMode,
  UserAccount,
  UserRole,
  calculateMultiDocumentOrderPricing,
  getPrimaryRole,
  getSchoolForProgramme,
  getUserRoles,
  normalizeRoles,
  userHasRole,
} from './src/types/printhaus';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  await initDatabase();

  const app = express();
  app.use(express.json({ limit: '30mb' }));

  // Optional CORS support for cross-origin Vercel -> Render deployment
  app.use((req, res, next) => {
    const allowedOriginRaw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '';
    const allowedOrigins = allowedOriginRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const requestOrigin = req.headers.origin;
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const confirmingOrderIds = new Set<string>();

  const sanitizeUser = (u: UserAccount): Omit<UserAccount, 'passwordHash'> => {
    const { passwordHash: _ignored, ...safe } = u;
    const roles = getUserRoles(u);
    return {
      ...safe,
      roles,
      role: getPrimaryRole(roles),
    };
  };

  const normalizeScanCode = (rawInput: string): string => {
    const trimmed = String(rawInput ?? '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed) as {
          qrReference?: string;
          orderCode?: string;
          collectionCode?: string;
        };
        const candidate = parsed.qrReference || parsed.orderCode || parsed.collectionCode || '';
        return String(candidate).trim().toUpperCase();
      } catch {
        // Treat as raw string
      }
    }
    return trimmed.toUpperCase();
  };

  const findOrderByIdentifier = (orders: PrintOrder[], rawIdentifier: string): PrintOrder | undefined => {
    const q = normalizeScanCode(rawIdentifier);
    if (!q) return undefined;
    return orders.find(
      (o) =>
        o.qrReference.toUpperCase() === q ||
        o.orderCode.toUpperCase() === q ||
        o.collectionCode.toUpperCase() === q ||
        o.id.toUpperCase() === q
    );
  };

  const confirmOrderCollection = (options: {
    identifier?: string;
    orderId?: string;
    staffUser: UserAccount;
    method: 'qr_scan' | 'manual_lookup';
  }):
    | { ok: true; order: PrintOrder; collectionEntry: CollectionHistoryEntry }
    | { ok: false; status: number; error: string; order?: PrintOrder } => {
    const db = getDb();
    const order = options.orderId
      ? db.orders.find((o) => o.id === options.orderId)
      : options.identifier
        ? findOrderByIdentifier(db.orders, options.identifier)
        : undefined;

    if (!order) {
      return {
        ok: false,
        status: 404,
        error: options.identifier
          ? `No order matches "${String(options.identifier).trim()}".`
          : 'Order not found.',
      };
    }

    if (confirmingOrderIds.has(order.id)) {
      return {
        ok: false,
        status: 409,
        error: `Collection confirmation for ${order.orderCode} is already in progress.`,
        order,
      };
    }

    confirmingOrderIds.add(order.id);
    try {
      if (order.status === 'collected') {
        const prev = order.collectionRecord;
        const when = prev?.collectedAt
          ? new Date(prev.collectedAt).toLocaleString()
          : new Date(order.updatedAt).toLocaleString();
        const who = prev?.staffName ? ` by ${prev.staffName}` : '';
        return {
          ok: false,
          status: 409,
          error: `Order ${order.orderCode} has already been collected on ${when}${who}.`,
          order,
        };
      }

      if (order.status !== 'ready_for_collection') {
        return {
          ok: false,
          status: 400,
          error: `Order ${order.orderCode} is currently "${getStatusLabel(order.status)}" and is not ready for collection.`,
          order,
        };
      }

      const nowIso = new Date().toISOString();
      const record: CollectionRecord = {
        orderId: order.id,
        orderCode: order.orderCode,
        collectionCode: order.collectionCode,
        qrReference: order.qrReference,
        studentId: order.studentId,
        studentName: order.studentName,
        matricNumber: order.matricNumber,
        staffId: options.staffUser.id,
        staffName: options.staffUser.name,
        staffEmail: options.staffUser.email,
        collectedAt: nowIso,
        amount: order.pricingBreakdown.totalAmount,
        paymentStatus: order.paymentStatus,
        method: options.method,
      };

      const entry: CollectionHistoryEntry = {
        id: `col_${crypto.randomUUID().slice(0, 8)}`,
        ...record,
        fileName: order.fileName,
        pickupVenue: order.pickupVenue,
        status: 'collected',
      };

      order.status = 'collected';
      order.updatedAt = nowIso;
      order.collectionRecord = record;
      order.statusHistory.push({
        status: 'collected',
        label: 'Collected',
        note: `Verified via ${options.method === 'qr_scan' ? 'QR scan' : 'manual lookup'} (${order.collectionCode}) at ${order.pickupVenue}.`,
        actor: options.staffUser.name,
        timestamp: nowIso,
      });

      const partner = db.partners.find((p) => p.id === order.assignedPartnerId);
      if (partner) partner.ordersCompleted += 1;

      db.collections.unshift(entry);
      db.notifications.unshift({
        id: `ntf_${crypto.randomUUID().slice(0, 8)}`,
        userId: order.studentId,
        orderCode: order.orderCode,
        title: `Order ${order.orderCode} collected`,
        message: `Handed over to ${order.studentName} by ${options.staffUser.name}. Receipt is saved in your order history.`,
        read: false,
        createdAt: nowIso,
      });

      saveDatabase();
      return { ok: true, order, collectionEntry: entry };
    } finally {
      confirmingOrderIds.delete(order.id);
    }
  };

  // --- AUTH ENDPOINTS ---
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const {
      name,
      email,
      password,
      matricNumber,
      school,
      department,
      residency,
      hostelGender,
      hostelName,
    } = req.body ?? {};
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.endsWith('@pau.edu.ng')) {
      res.status(400).json({
        error: 'Public registration is restricted to PAU student email addresses (@pau.edu.ng).',
      });
      return;
    }

    const db = getDb();
    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const prog = department ? String(department).trim() : 'Computer Science';
    const isCampus = residency === 'on-campus';

    const rawPassword = String(password);
    if (rawPassword.length < 6 || rawPassword.length > 128) {
      res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    // Ignore any role/roles in body — public signup is strictly student-only
    const newUser: UserAccount = {
      id: `usr_${crypto.randomUUID().slice(0, 8)}`,
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash: hashPasswordScrypt(rawPassword),
      matricNumber: matricNumber ? String(matricNumber).trim() : 'PAU-NEW',
      school: school ? String(school).trim() : getSchoolForProgramme(prog),
      department: prog,
      residency: isCampus ? 'on-campus' : 'off-campus',
      hostelGender: isCampus ? (hostelGender === 'female' ? 'female' : 'male') : undefined,
      hostelName: isCampus && hostelName ? String(hostelName).trim() : undefined,
      role: 'student',
      roles: ['student'],
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);
    saveDatabase();
    res.status(201).json({
      user: sanitizeUser(newUser),
      token: issueSessionToken(newUser.id),
    });
  });

  app.post('/api/auth/firebase-sync', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
    if (!bearer) {
      res.status(401).json({ error: 'Verified Firebase ID token is required.' });
      return;
    }

    let decoded;
    try {
      decoded = await verifyFirebaseBearerToken(bearer);
    } catch {
      res.status(401).json({ error: 'Invalid or expired Firebase ID token.' });
      return;
    }

    const cleanUid = decoded.uid;
    const normalizedEmail = String(decoded.email || '').trim().toLowerCase();
    if (!cleanUid || !normalizedEmail) {
      res.status(400).json({ error: 'Verified Firebase account must include UID and email.' });
      return;
    }

    const {
      checkOnly,
      name,
      matricNumber,
      school,
      department,
      residency,
      hostelGender,
      hostelName,
    } = req.body ?? {};

    const db = getDb();
    const prog = department ? String(department).trim() : 'Computer Science';
    const isCampus = residency === 'on-campus';

    const existing = db.users.find(
      (u) => u.id === cleanUid || u.email.toLowerCase() === normalizedEmail
    );

    if (checkOnly && !existing) {
      res.json({ exists: false, user: null });
      return;
    }

    if (existing) {
      if (existing.status === 'suspended') {
        res.status(403).json({
          error: 'This account has been deactivated or suspended. Contact PrintHaus Admin.',
        });
        return;
      }

      if (existing.id !== cleanUid) {
        const previousId = existing.id;
        existing.id = cleanUid;
        for (const order of db.orders) {
          if (order.studentId === previousId) order.studentId = cleanUid;
        }
        for (const ntf of db.notifications) {
          if (ntf.userId === previousId) ntf.userId = cleanUid;
        }
        for (const cmp of db.complaints) {
          if (cmp.studentId === previousId) cmp.studentId = cleanUid;
        }
        for (const col of db.collections) {
          if (col.studentId === previousId) col.studentId = cleanUid;
          if (col.staffId === previousId) col.staffId = cleanUid;
        }
      }

      // Preserve server-authoritative roles — never read roles from client payload
      existing.roles = getUserRoles(existing);
      existing.role = getPrimaryRole(existing.roles);

      if (name) existing.name = String(name).trim();
      if (matricNumber) existing.matricNumber = String(matricNumber).trim();
      if (department) {
        existing.department = prog;
        existing.school = school ? String(school).trim() : getSchoolForProgramme(prog) || existing.school;
      }
      if (residency === 'on-campus' || residency === 'off-campus') {
        existing.residency = isCampus ? 'on-campus' : 'off-campus';
        existing.hostelGender = isCampus
          ? hostelGender === 'female'
            ? 'female'
            : 'male'
          : undefined;
        existing.hostelName =
          isCampus && hostelName ? String(hostelName).trim() : undefined;
      }

      saveDatabase();
      res.json({ user: sanitizeUser(existing) });
      return;
    }

    const isBootstrappedAdmin = normalizedEmail === 'chukwuemekaodoemene@gmail.com';
    const roles: UserRole[] = isBootstrappedAdmin ? ['admin', 'student'] : ['student'];
    const createdUser: UserAccount = {
      id: cleanUid,
      name: String(name || decoded.name || 'PAU Student').trim(),
      email: normalizedEmail,
      matricNumber: matricNumber ? String(matricNumber).trim() : 'PAU-NEW',
      school: school ? String(school).trim() : getSchoolForProgramme(prog),
      department: prog,
      residency: isCampus ? 'on-campus' : 'off-campus',
      hostelGender: isCampus ? (hostelGender === 'female' ? 'female' : 'male') : undefined,
      hostelName: isCampus && hostelName ? String(hostelName).trim() : undefined,
      role: getPrimaryRole(roles),
      roles,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    db.users.push(createdUser);
    saveDatabase();
    res.status(201).json({ user: sanitizeUser(createdUser) });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: sanitizeUser(req.authUser!) });
  });

  app.patch('/api/users/:id/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const authUser = req.authUser!;
    if (authUser.id !== req.params.id && !userHasRole(authUser, 'admin')) {
      res.status(403).json({ error: 'Forbidden: you can only update your own profile.' });
      return;
    }

    const db = getDb();
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const { department, residency, hostelGender, hostelName } = req.body ?? {};
    if (department) {
      user.department = String(department).trim();
      user.school = getSchoolForProgramme(user.department) || user.school;
    }
    if (residency === 'on-campus' || residency === 'off-campus') {
      user.residency = residency;
      if (residency === 'off-campus') {
        user.hostelGender = undefined;
        user.hostelName = undefined;
      } else {
        if (hostelGender === 'male' || hostelGender === 'female') {
          user.hostelGender = hostelGender;
        }
        if (hostelName) {
          user.hostelName = String(hostelName).trim();
        }
      }
    }
    saveDatabase();
    res.json({ user: sanitizeUser(user) });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    const db = getDb();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user || !verifyPassword(String(password ?? ''), user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (user.status === 'suspended') {
      res.status(403).json({
        error: 'This account has been deactivated or suspended. Contact PrintHaus Admin.',
      });
      return;
    }

    res.json({
      user: sanitizeUser(user),
      token: issueSessionToken(user.id),
    });
  });

  // --- FORGOT PASSWORD / EMAIL CODE RECOVERY ---
  interface PasswordResetChallenge {
    userId: string;
    email: string;
    salt: string;
    codeHash: string;
    expiresAt: number;
    attempts: number;
    verified: boolean;
    recoveryTokenHash: string | null;
    requestTimestamps: number[];
  }

  const resetChallenges = new Map<string, PasswordResetChallenge>();

  const hashResetSecret = (salt: string, value: string): string =>
    crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex');

  const constantTimeHexEqual = (aHex: string, bHex: string): boolean => {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  };

  app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
    const rawEmail = String(req.body?.email ?? '').trim().toLowerCase();
    if (!rawEmail || rawEmail.length > 160 || !rawEmail.includes('@')) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const db = getDb();
    const user = db.users.find((u) => u.email.toLowerCase() === rawEmail);
    const now = Date.now();
    const existing = resetChallenges.get(rawEmail);
    const recentRequests = (existing?.requestTimestamps ?? []).filter(
      (ts) => now - ts < 15 * 60 * 1000
    );

    if (recentRequests.length >= 5) {
      res.status(429).json({
        error: 'Too many verification code requests. Please wait a few minutes before trying again.',
      });
      return;
    }

    if (!user || user.status === 'suspended') {
      res.json({
        ok: true,
        delivery: process.env.RESEND_API_KEY ? 'email' : 'none',
        message: 'If an active PrintHaus account matches that email, a 6-digit verification code has been sent.',
      });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString('hex');
    const challenge: PasswordResetChallenge = {
      userId: user.id,
      email: rawEmail,
      salt,
      codeHash: hashResetSecret(salt, code),
      expiresAt: now + 10 * 60 * 1000,
      attempts: 0,
      verified: false,
      recoveryTokenHash: null,
      requestTimestamps: [...recentRequests, now],
    };
    resetChallenges.set(rawEmail, challenge);

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const fromAddr = process.env.EMAIL_FROM || 'PrintHaus PAU <onboarding@resend.dev>';
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [rawEmail],
            subject: 'PrintHaus Verification Code',
            text: `Hello ${user.name},\n\nYour PrintHaus 6-digit verification code is: ${code}\n\nThis code expires in 10 minutes. Once verified, you can choose to change your password or enter PrintHaus directly.\n\nIf you did not request this, you can safely ignore this email.`,
          }),
        });
        if (!emailRes.ok) {
          res.status(502).json({ error: 'Unable to send verification email right now. Please try again.' });
          return;
        }
        res.json({
          ok: true,
          delivery: 'email',
          message: `A 6-digit verification code has been sent to ${rawEmail}.`,
        });
        return;
      } catch {
        res.status(502).json({ error: 'Email service is temporarily unreachable.' });
        return;
      }
    }

    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({
        error: 'Email delivery is not configured on this server. Ask PrintHaus Admin to set RESEND_API_KEY.',
      });
      return;
    }

    if (userHasRole(user, 'staff') || userHasRole(user, 'admin')) {
      res.status(503).json({
        error: 'Email delivery requires RESEND_API_KEY for staff and admin password recovery.',
      });
      return;
    }

    res.json({
      ok: true,
      delivery: 'preview',
      previewCode: code,
      message: `A 6-digit verification code was generated for ${rawEmail}.`,
    });
  });

  app.post('/api/auth/forgot-password/verify', (req: Request, res: Response) => {
    const rawEmail = String(req.body?.email ?? '').trim().toLowerCase();
    const code = String(req.body?.code ?? '').trim();

    if (!rawEmail || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Enter a valid email address and 6-digit verification code.' });
      return;
    }

    const challenge = resetChallenges.get(rawEmail);
    if (!challenge) {
      res.status(400).json({ error: 'No active verification code found. Please request a new code.' });
      return;
    }

    if (Date.now() > challenge.expiresAt) {
      resetChallenges.delete(rawEmail);
      res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
      return;
    }

    challenge.attempts += 1;
    if (challenge.attempts > 5) {
      resetChallenges.delete(rawEmail);
      res.status(429).json({ error: 'Too many invalid attempts. Please request a new code.' });
      return;
    }

    const submittedHash = hashResetSecret(challenge.salt, code);
    if (!constantTimeHexEqual(submittedHash, challenge.codeHash)) {
      res.status(401).json({
        error: `Incorrect verification code. ${Math.max(0, 5 - challenge.attempts)} attempt(s) remaining.`,
      });
      return;
    }

    const recoveryToken = crypto.randomBytes(32).toString('hex');
    challenge.verified = true;
    challenge.recoveryTokenHash = hashResetSecret(challenge.salt, recoveryToken);
    challenge.expiresAt = Date.now() + 10 * 60 * 1000;

    res.json({ verified: true, recoveryToken });
  });

  app.post('/api/auth/forgot-password/complete', (req: Request, res: Response) => {
    const rawEmail = String(req.body?.email ?? '').trim().toLowerCase();
    const recoveryToken = String(req.body?.recoveryToken ?? '').trim();
    const action = req.body?.action === 'reset_password' ? 'reset_password' : 'enter_app';
    const newPassword = String(req.body?.newPassword ?? '');

    if (!rawEmail || !recoveryToken) {
      res.status(400).json({ error: 'Missing email or recovery verification token.' });
      return;
    }

    const challenge = resetChallenges.get(rawEmail);
    if (!challenge || !challenge.verified || !challenge.recoveryTokenHash) {
      res.status(401).json({ error: 'Recovery session expired or invalid. Please request a new code.' });
      return;
    }

    if (Date.now() > challenge.expiresAt) {
      resetChallenges.delete(rawEmail);
      res.status(401).json({ error: 'Recovery session has expired. Please request a new code.' });
      return;
    }

    const submittedTokenHash = hashResetSecret(challenge.salt, recoveryToken);
    if (!constantTimeHexEqual(submittedTokenHash, challenge.recoveryTokenHash)) {
      res.status(401).json({ error: 'Invalid recovery token.' });
      return;
    }

    const db = getDb();
    const user = db.users.find((u) => u.id === challenge.userId);
    if (!user || user.status === 'suspended') {
      resetChallenges.delete(rawEmail);
      res.status(403).json({ error: 'Account not available.' });
      return;
    }

    if (action === 'reset_password') {
      if (newPassword.length < 6 || newPassword.length > 128) {
        res.status(400).json({ error: 'New password must be between 6 and 128 characters.' });
        return;
      }
      user.passwordHash = hashPasswordScrypt(newPassword);
      saveDatabase();
    }

    resetChallenges.delete(rawEmail);
    res.json({
      user: sanitizeUser(user),
      token: issueSessionToken(user.id),
    });
  });

  app.get('/api/auth/demo-accounts', (_req: Request, res: Response) => {
    const db = getDb();
    res.json({
      accounts: db.users
        .filter((u) => ['usr_student_1', 'usr_student_2', 'usr_staff_1', 'usr_admin_1'].includes(u.id))
        .map(sanitizeUser),
    });
  });

  // --- PRICING ENDPOINTS ---
  app.get('/api/pricing', (_req: Request, res: Response) => {
    const db = getDb();
    res.json({ pricing: db.pricing });
  });

  app.put('/api/pricing', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const body = req.body ?? {};
    const numericFields = [
      'bwSinglePerPage',
      'bwDoublePerPage',
      'colorSinglePerPage',
      'colorDoublePerPage',
      'stapling',
      'spiralBinding',
      'laminationPerPage',
      'urgentFee',
      'packagingFee',
      'operatingCostPerOrder',
      'partnerBwRate',
      'partnerColorRate',
      'firstOrderDiscountPct',
      'bulkThresholdDocuments',
      'bulkDiscountPct',
    ] as const;

    for (const field of numericFields) {
      if (body[field] !== undefined) {
        const val = Number(body[field]);
        if (!Number.isNaN(val) && val >= 0) {
          db.pricing[field] = val;
        }
      }
    }
    db.pricing.updatedAt = new Date().toISOString();
    saveDatabase();
    res.json({ pricing: db.pricing });
  });

  // --- DOCUMENT UPLOAD & DOWNLOAD ---
  app.post('/api/documents/upload', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { fileName, mimeType, base64Data, fallbackPageCount } = req.body ?? {};
      if (!fileName || !base64Data) {
        res.status(400).json({ error: 'File name and file payload are required.' });
        return;
      }

      const cleanBase64 = String(base64Data).includes(',')
        ? String(base64Data).split(',')[1]
        : String(base64Data);
      const buffer = Buffer.from(cleanBase64, 'base64');

      const docId = `doc_${crypto.randomUUID().slice(0, 10)}`;
      const ext = path.extname(String(fileName)) || '.bin';
      const storagePath = path.join(getUploadsDir(), `${docId}${ext}`);
      fs.writeFileSync(storagePath, buffer);

      let pageCount = Number(fallbackPageCount) > 0 ? Math.round(Number(fallbackPageCount)) : 1;
      const lowerName = String(fileName).toLowerCase();
      const lowerMime = String(mimeType ?? '').toLowerCase();

      if (lowerName.endsWith('.pdf') || lowerMime.includes('pdf')) {
        try {
          const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
          const detected = pdfDoc.getPageCount();
          if (detected > 0) pageCount = detected;
        } catch {
          const text = buffer.toString('latin1');
          const matches = text.match(/\/Type\s*\/Page[^s]/g);
          if (matches && matches.length > 0) pageCount = matches.length;
        }
      } else if (lowerName.endsWith('.txt')) {
        const lines = buffer.toString('utf-8').split('\n').length;
        pageCount = Math.max(1, Math.ceil(lines / 42));
      } else if (lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) {
        if (!fallbackPageCount) {
          pageCount = Math.max(1, Math.min(80, Math.round(buffer.length / 18000)));
        }
      }

      const db = getDb();
      const record = {
        id: docId,
        fileName: String(fileName),
        mimeType: String(mimeType || 'application/octet-stream'),
        size: buffer.length,
        pageCount,
        storagePath,
        uploadedBy: req.authUser!.id,
        createdAt: new Date().toISOString(),
      };
      db.documents.push(record);
      saveDatabase();

      res.status(201).json({
        document: {
          id: record.id,
          fileName: record.fileName,
          mimeType: record.mimeType,
          size: record.size,
          pageCount: record.pageCount,
          createdAt: record.createdAt,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
    }
  });

  app.get('/api/documents/:id/file', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const doc = db.documents.find((d) => d.id === req.params.id);
    if (!doc || !fs.existsSync(doc.storagePath)) {
      res.status(404).json({ error: 'Document file not found.' });
      return;
    }

    const authUser = req.authUser!;
    const isPrivileged = userHasRole(authUser, 'staff') || userHasRole(authUser, 'admin');
    const isUploader = doc.uploadedBy === authUser.id;
    const ownsLinkedOrder = db.orders.some(
      (o) =>
        o.studentId === authUser.id &&
        (o.documentId === doc.id || (o.items ?? []).some((item) => item.documentId === doc.id))
    );

    if (!isPrivileged && !isUploader && !ownsLinkedOrder) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this document.' });
      return;
    }

    const download = req.query.download === '1';
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(doc.fileName)}"`
    );
    fs.createReadStream(doc.storagePath).pipe(res);
  });

  // --- ORDERS ---
  app.get('/api/orders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const authUser = req.authUser!;
    const { studentId, status, scope } = req.query;
    const isPrivileged = userHasRole(authUser, 'staff') || userHasRole(authUser, 'admin');

    let list = [...db.orders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (scope === 'student' || !isPrivileged) {
      list = list.filter((o) => o.studentId === authUser.id);
    } else if (studentId) {
      list = list.filter((o) => o.studentId === String(studentId));
    }

    if (status && status !== 'all') {
      list = list.filter((o) => o.status === String(status));
    }
    res.json({ orders: list });
  });

  app.get('/api/orders/track/:code', (req: Request, res: Response) => {
    const db = getDb();
    const order = findOrderByIdentifier(db.orders, req.params.code);
    if (!order) {
      res.status(404).json({ error: `No order found matching "${String(req.params.code).trim()}".` });
      return;
    }

    // Public tracker intentionally omits student PII, document IDs, and private QR token
    res.json({
      order: {
        id: order.id,
        orderCode: order.orderCode,
        fileName: order.fileName,
        pageCount: order.pageCount,
        specs: { copies: order.specs.copies },
        pricingBreakdown: { totalAmount: order.pricingBreakdown.totalAmount },
        status: order.status,
        statusHistory: order.statusHistory,
        pickupVenue: order.pickupVenue,
        pickupShelf: order.pickupShelf,
        rejectionReason: order.rejectionReason,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  });

  app.post('/api/orders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const authUser = req.authUser!;
    const {
      documentId,
      fileName,
      fileSize,
      fileType,
      pageCount,
      specs,
      items,
      paymentMethod,
      pickupVenue,
      pickupSlot,
    } = req.body ?? {};

    const normalizeSpecs = (raw: any) => ({
      copies: Math.max(1, Number(raw?.copies ?? 1)),
      colorMode: (raw?.colorMode === 'color' ? 'color' : 'bw') as ColorMode,
      sided: (raw?.sided === 'double' ? 'double' : 'single') as SidedMode,
      binding: (['none', 'stapling', 'spiral'].includes(raw?.binding)
        ? raw.binding
        : 'none') as BindingOption,
      lamination: Boolean(raw?.lamination),
      urgent: Boolean(raw?.urgent),
      notes: String(raw?.notes ?? '').slice(0, 300),
    });

    let rawItems: OrderDocumentItemInput[] = [];
    if (Array.isArray(items) && items.length > 0) {
      rawItems = items
        .filter((it: any) => it && it.documentId && it.fileName)
        .map((it: any, idx: number) => ({
          id: it.id ? String(it.id) : `item_${idx + 1}`,
          documentId: String(it.documentId),
          fileName: String(it.fileName),
          fileSize: Number(it.fileSize) || 0,
          fileType: String(it.fileType || 'application/pdf'),
          pageCount: Math.max(1, Number(it.pageCount) || 1),
          recipientLabel: String(it.recipientLabel || 'Self').slice(0, 80),
          specs: normalizeSpecs(it.specs),
        }));
    } else if (documentId && fileName) {
      rawItems = [
        {
          id: 'item_1',
          documentId: String(documentId),
          fileName: String(fileName),
          fileSize: Number(fileSize) || 0,
          fileType: String(fileType || 'application/pdf'),
          pageCount: Math.max(1, Number(pageCount) || 1),
          recipientLabel: 'Self',
          specs: normalizeSpecs(specs),
        },
      ];
    }

    if (rawItems.length === 0) {
      res.status(400).json({ error: 'At least one uploaded document is required.' });
      return;
    }

    const existingStudentOrders = db.orders.filter((o) => o.studentId === authUser.id);
    const isFirstOrder = existingStudentOrders.length === 0;
    const { breakdown: pricingBreakdown, computedItems } = calculateMultiDocumentOrderPricing(
      rawItems,
      db.pricing,
      isFirstOrder
    );

    const primaryItem = computedItems[0];
    const summaryFileName =
      computedItems.length > 1
        ? `${primaryItem.fileName} + ${computedItems.length - 1} more`
        : primaryItem.fileName;
    const summaryPageCount = computedItems.reduce((sum, item) => sum + item.pageCount, 0);
    const totalCopies = computedItems.reduce((sum, item) => sum + item.specs.copies, 0);
    const summarySpecs = {
      ...primaryItem.specs,
      copies: totalCopies,
      urgent: computedItems.some((item) => item.specs.urgent),
      notes: computedItems
        .map((item) =>
          item.specs.notes ? `${item.recipientLabel}: ${item.specs.notes}` : ''
        )
        .filter(Boolean)
        .join(' | ')
        .slice(0, 300),
    };

    const { orderCode, collectionCode, qrReference } = generateOrderCodes(db.orders);
    const primaryPartner =
      db.partners.find((p) => p.type === 'primary' && p.status === 'available') ||
      db.partners.find((p) => p.status !== 'offline') ||
      db.partners[0];

    const method: PaymentMethod = ['paystack_card', 'bank_transfer', 'campus_wallet'].includes(
      paymentMethod
    )
      ? paymentMethod
      : 'paystack_card';

    const autoConfirmed = method === 'paystack_card' || method === 'campus_wallet';
    const nowIso = new Date().toISOString();

    const statusHistory = [
      {
        status: 'order_received' as OrderStatus,
        label: 'Order received',
        note:
          computedItems.length > 1
            ? `Uploaded ${computedItems.length} documents (${totalCopies} total copies, ${pricingBreakdown.totalPages} pages).`
            : `Uploaded ${primaryItem.fileName} (${primaryItem.pageCount} pages, ${primaryItem.specs.copies}x).`,
        actor: authUser.name,
        timestamp: nowIso,
      },
    ];

    if (autoConfirmed) {
      statusHistory.push({
        status: 'payment_confirmed',
        label: 'Payment confirmed',
        note:
          method === 'paystack_card'
            ? 'Instant Paystack card payment verified.'
            : 'PAU Campus Wallet debit confirmed.',
        actor: 'System',
        timestamp: nowIso,
      });
    }

    const newOrder: PrintOrder = {
      id: `ord_${crypto.randomUUID().slice(0, 8)}`,
      orderCode,
      collectionCode,
      qrReference,
      studentId: authUser.id,
      studentName: authUser.name,
      studentEmail: authUser.email,
      matricNumber: authUser.matricNumber || 'PAU-STD',
      documentId: primaryItem.documentId,
      fileName: summaryFileName,
      fileSize: computedItems.reduce((sum, item) => sum + item.fileSize, 0),
      fileType: primaryItem.fileType,
      pageCount: summaryPageCount,
      specs: summarySpecs,
      items: computedItems,
      pricingBreakdown,
      paymentMethod: method,
      paymentStatus: autoConfirmed ? 'confirmed' : 'pending',
      paymentReference: `${method === 'bank_transfer' ? 'TRF' : 'PSK'}-${Math.floor(
        100000 + Math.random() * 899999
      )}`,
      status: autoConfirmed ? 'payment_confirmed' : 'order_received',
      statusHistory,
      qualityChecklist: {
        correctDocument: false,
        correctCopies: false,
        correctPageCount: false,
        correctFormat: false,
        printQuality: false,
        packagedAndLabeled: false,
      },
      assignedPartnerId: primaryPartner?.id ?? 'ptr_primary',
      assignedPartnerName: primaryPartner?.name ?? 'Lekki Academic Press (Primary)',
      pickupVenue: String(pickupVenue || 'Security Post in TYD'),
      pickupSlot: String(pickupSlot || 'Anytime during operating hours'),
      pickupShelf: null,
      rejectionReason: null,
      collectionRecord: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    db.orders.unshift(newOrder);
    db.notifications.unshift({
      id: `ntf_${crypto.randomUUID().slice(0, 8)}`,
      userId: newOrder.studentId,
      orderCode: newOrder.orderCode,
      title: `Order ${newOrder.orderCode} submitted`,
      message: autoConfirmed
        ? `Payment confirmed. Your collection code is ${newOrder.collectionCode}.`
        : `Order received. Staff will verify your bank transfer reference ${newOrder.paymentReference}.`,
      read: false,
      createdAt: nowIso,
    });

    saveDatabase();
    res.status(201).json({ order: newOrder });
  });

  app.patch(
    '/api/orders/:id/payment',
    requireAuth,
    requireRole('staff', 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const order = db.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }

      const actorName = req.authUser!.name;
      const nowIso = new Date().toISOString();
      order.paymentStatus = 'confirmed';
      if (order.status === 'order_received') {
        order.status = 'payment_confirmed';
        order.statusHistory.push({
          status: 'payment_confirmed',
          label: 'Payment confirmed',
          note: `Transfer reference ${order.paymentReference} verified.`,
          actor: actorName,
          timestamp: nowIso,
        });
      }
      order.updatedAt = nowIso;

      db.notifications.unshift({
        id: `ntf_${crypto.randomUUID().slice(0, 8)}`,
        userId: order.studentId,
        orderCode: order.orderCode,
        title: `Payment confirmed for ${order.orderCode}`,
        message: `Your payment (${order.paymentReference}) has been verified and queued for printing.`,
        read: false,
        createdAt: nowIso,
      });

      saveDatabase();
      res.json({ order });
    }
  );

  app.patch(
    '/api/orders/:id/status',
    requireAuth,
    requireRole('staff', 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const order = db.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }

      const { status, note, qualityChecklist, pickupShelf, assignedPartnerId, rejectionReason } =
        req.body ?? {};
      const actorName = req.authUser!.name;

      if (status === 'collected') {
        const result = confirmOrderCollection({
          orderId: order.id,
          staffUser: req.authUser!,
          method: 'manual_lookup',
        });
        if (!result.ok) {
          res.status(result.status).json({ error: result.error, order: result.order });
          return;
        }
        res.json({ order: result.order });
        return;
      }

      const nowIso = new Date().toISOString();

      if (qualityChecklist) {
        order.qualityChecklist = { ...order.qualityChecklist, ...qualityChecklist };
      }

      if (assignedPartnerId) {
        const partner = db.partners.find((p) => p.id === assignedPartnerId);
        if (partner) {
          order.assignedPartnerId = partner.id;
          order.assignedPartnerName = partner.name;
        }
      }

      if (status) {
        const nextStatus = status as OrderStatus;
        order.status = nextStatus;

        if (nextStatus === 'ready_for_collection') {
          order.pickupShelf =
            pickupShelf ||
            order.pickupShelf ||
            `Cubby ${String.fromCharCode(65 + (db.orders.length % 3))}-${String(
              (db.orders.length % 15) + 1
            ).padStart(2, '0')}`;
        }

        if (nextStatus === 'rejected') {
          order.rejectionReason = String(rejectionReason || 'File formatting issue detected.');
        }

        order.statusHistory.push({
          status: nextStatus,
          label: getStatusLabel(nextStatus),
          note:
            String(note || '').trim() ||
            (nextStatus === 'ready_for_collection'
              ? `Packaged and placed at ${order.pickupVenue} (${order.pickupShelf}).`
              : `Updated to ${getStatusLabel(nextStatus)}.`),
          actor: actorName,
          timestamp: nowIso,
        });

        const titleMap: Partial<Record<OrderStatus, string>> = {
          printing_in_progress: `Printing started for ${order.orderCode}`,
          quality_check: `Quality inspection underway for ${order.orderCode}`,
          ready_for_collection: `${order.orderCode} is ready at ${order.pickupVenue}`,
          rejected: `Action needed on order ${order.orderCode}`,
        };

        if (titleMap[nextStatus]) {
          db.notifications.unshift({
            id: `ntf_${crypto.randomUUID().slice(0, 8)}`,
            userId: order.studentId,
            orderCode: order.orderCode,
            title: titleMap[nextStatus]!,
            message:
              nextStatus === 'ready_for_collection'
                ? `Collect anytime during operating hours at ${order.pickupVenue} (${order.pickupShelf}) with code ${order.collectionCode} or QR slip.`
                : String(note || `Order status is now ${getStatusLabel(nextStatus)}.`),
            read: false,
            createdAt: nowIso,
          });
        }
      }

      order.updatedAt = nowIso;
      saveDatabase();
      res.json({ order });
    }
  );

  // --- STAFF COLLECTION, OVERVIEW, SUPPLIES & PARTNERS ---
  app.get(
    '/api/staff/overview',
    requireAuth,
    requireRole('staff', 'admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const sortedCollections = [...db.collections].sort(
        (a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime()
      );
      res.json({
        metrics: {
          totalOrders: db.orders.length,
          pendingOrders: db.orders.filter((o) =>
            ['order_received', 'payment_confirmed'].includes(o.status)
          ).length,
          processingOrders: db.orders.filter((o) =>
            ['printing_in_progress', 'quality_check'].includes(o.status)
          ).length,
          readyForCollection: db.orders.filter((o) => o.status === 'ready_for_collection').length,
          collectedOrders: db.orders.filter((o) => o.status === 'collected').length,
          recentCollections: sortedCollections.slice(0, 8),
        },
      });
    }
  );

  app.post(
    '/api/staff/collection/lookup',
    requireAuth,
    requireRole('staff', 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const rawCode = String(req.body?.code ?? '').trim();
      if (!rawCode) {
        res.status(400).json({ error: 'Enter or scan a QR reference, order number, or collection code.' });
        return;
      }

      const order = findOrderByIdentifier(db.orders, rawCode);
      if (!order) {
        res.status(404).json({ error: `No order found matching "${rawCode}".` });
        return;
      }

      const alreadyCollected = order.status === 'collected';
      const canConfirm = order.status === 'ready_for_collection';
      let blockReason: string | null = null;
      if (alreadyCollected) {
        const who = order.collectionRecord?.staffName
          ? ` by ${order.collectionRecord.staffName}`
          : '';
        const when = order.collectionRecord?.collectedAt
          ? ` on ${new Date(order.collectionRecord.collectedAt).toLocaleString()}`
          : '';
        blockReason = `This order has already been collected${when}${who}.`;
      } else if (!canConfirm) {
        blockReason = `Order is currently "${getStatusLabel(order.status)}". Mark it Ready for Pickup before confirming collection.`;
      }

      res.json({
        order,
        canConfirm,
        alreadyCollected,
        blockReason,
      });
    }
  );

  app.post(
    '/api/staff/collection/confirm',
    requireAuth,
    requireRole('staff', 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const { code, orderId, method } = req.body ?? {};
      const confirmMethod = method === 'manual_lookup' ? 'manual_lookup' : 'qr_scan';
      const result = confirmOrderCollection({
        identifier: code ? String(code) : undefined,
        orderId: orderId ? String(orderId) : undefined,
        staffUser: req.authUser!,
        method: confirmMethod,
      });

      if (!result.ok) {
        res.status(result.status).json({ error: result.error, order: result.order });
        return;
      }

      res.json({
        order: result.order,
        collectionEntry: result.collectionEntry,
      });
    }
  );

  app.post(
    '/api/orders/verify-collection',
    requireAuth,
    requireRole('staff', 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const { code, method } = req.body ?? {};
      const result = confirmOrderCollection({
        identifier: code ? String(code) : undefined,
        staffUser: req.authUser!,
        method: method === 'manual_lookup' ? 'manual_lookup' : 'qr_scan',
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, order: result.order });
        return;
      }
      res.json({
        order: result.order,
        collectionEntry: result.collectionEntry,
      });
    }
  );

  app.get(
    '/api/staff/collections',
    requireAuth,
    requireRole('staff', 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const q = String(req.query.q ?? '').trim().toLowerCase();
      const dateFilter = String(req.query.date ?? '').trim();
      const staffIdFilter = String(req.query.staffId ?? '').trim();

      const allSorted = [...db.collections].sort(
        (a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime()
      );

      const staffMap = new Map<string, { staffId: string; staffName: string; staffEmail: string }>();
      for (const entry of allSorted) {
        if (!staffMap.has(entry.staffId)) {
          staffMap.set(entry.staffId, {
            staffId: entry.staffId,
            staffName: entry.staffName,
            staffEmail: entry.staffEmail,
          });
        }
      }

      const filtered = allSorted.filter((entry) => {
        if (q) {
          const matchesQuery =
            entry.orderCode.toLowerCase().includes(q) ||
            entry.collectionCode.toLowerCase().includes(q) ||
            entry.studentName.toLowerCase().includes(q) ||
            entry.staffName.toLowerCase().includes(q) ||
            (entry.matricNumber || '').toLowerCase().includes(q);
          if (!matchesQuery) return false;
        }
        if (dateFilter) {
          const entryDate = entry.collectedAt.slice(0, 10);
          if (entryDate !== dateFilter) return false;
        }
        if (staffIdFilter && staffIdFilter !== 'all' && entry.staffId !== staffIdFilter) {
          return false;
        }
        return true;
      });

      res.json({
        collections: filtered,
        staffOptions: Array.from(staffMap.values()),
      });
    }
  );

  app.get(
    '/api/staff/supplies',
    requireAuth,
    requireRole('staff', 'admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      res.json({ supplies: db.supplies });
    }
  );

  app.patch(
    '/api/staff/supplies/:id',
    requireAuth,
    requireRole('staff', 'admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const item = db.supplies.find((s) => s.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Supply item not found.' });
        return;
      }
      const { quantity, delta } = req.body ?? {};
      if (typeof quantity === 'number') {
        item.quantity = Math.max(0, Math.round(quantity));
      } else if (typeof delta === 'number') {
        item.quantity = Math.max(0, item.quantity + Math.round(delta));
      }
      item.updatedAt = new Date().toISOString();
      saveDatabase();
      res.json({ supply: item });
    }
  );

  app.get(
    '/api/staff/partners',
    requireAuth,
    requireRole('staff', 'admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      res.json({ partners: db.partners });
    }
  );

  // --- ADMIN: OVERVIEW, USERS, STAFF MANAGEMENT, PARTNERS, COMPLAINTS ---
  app.get(
    '/api/admin/overview',
    requireAuth,
    requireRole('admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const activeOrders = db.orders.filter(
        (o) => o.status !== 'rejected' && o.paymentStatus !== 'refunded'
      );
      const grossRevenue = activeOrders.reduce((s, o) => s + o.pricingBreakdown.totalAmount, 0);
      const partnerPayouts = activeOrders.reduce((s, o) => s + o.pricingBreakdown.partnerCost, 0);
      const packagingAndOperating = activeOrders.reduce(
        (s, o) => s + o.pricingBreakdown.packagingCost + o.pricingBreakdown.operatingCost,
        0
      );
      const netContribution = grossRevenue - partnerPayouts - packagingAndOperating;
      const totalPagesPrinted = activeOrders.reduce((s, o) => s + o.pricingBreakdown.totalPages, 0);

      const ordersByStudent = new Map<string, number>();
      for (const o of activeOrders) {
        ordersByStudent.set(o.studentId, (ordersByStudent.get(o.studentId) ?? 0) + 1);
      }
      const uniqueStudents = ordersByStudent.size;
      const repeatCustomers = Array.from(ordersByStudent.values()).filter((c) => c > 1).length;

      res.json({
        metrics: {
          totalOrders: db.orders.length,
          activeQueueCount: db.orders.filter((o) => !['collected', 'rejected'].includes(o.status))
            .length,
          readyForPickupCount: db.orders.filter((o) => o.status === 'ready_for_collection').length,
          grossRevenue,
          partnerPayouts,
          packagingAndOperating,
          netContribution,
          totalPagesPrinted,
          uniqueStudents,
          repeatCustomers,
          openComplaints: db.complaints.filter((c) => c.status === 'open').length,
        },
      });
    }
  );

  app.get(
    '/api/admin/users',
    requireAuth,
    requireRole('admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      res.json({ users: db.users.map(sanitizeUser) });
    }
  );

  app.get(
    '/api/admin/staff',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const q = String(req.query.q ?? '').trim().toLowerCase();

      const activityByStaff = new Map<
        string,
        {
          totalCollections: number;
          lastCollectedAt: string | null;
          recentCollections: CollectionHistoryEntry[];
        }
      >();

      const sortedCollections = [...db.collections].sort(
        (a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime()
      );

      for (const col of sortedCollections) {
        const current = activityByStaff.get(col.staffId) || {
          totalCollections: 0,
          lastCollectedAt: null,
          recentCollections: [],
        };
        current.totalCollections += 1;
        if (!current.lastCollectedAt) current.lastCollectedAt = col.collectedAt;
        if (current.recentCollections.length < 5) current.recentCollections.push(col);
        activityByStaff.set(col.staffId, current);
      }

      const staffList = db.users
        .filter((u) => userHasRole(u, 'staff') || userHasRole(u, 'admin'))
        .filter((u) => {
          if (!q) return true;
          return (
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            (u.department || '').toLowerCase().includes(q)
          );
        })
        .map((u) => {
          const activity = activityByStaff.get(u.id) || {
            totalCollections: 0,
            lastCollectedAt: null,
            recentCollections: [],
          };
          return {
            ...sanitizeUser(u),
            collectionStats: activity,
          };
        });

      res.json({
        staff: staffList,
        recentCollections: sortedCollections.slice(0, 15),
      });
    }
  );

  app.post(
    '/api/admin/users',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const { name, email, role, roles, department, matricNumber, residency, password } =
        req.body ?? {};
      if (!email) {
        res.status(400).json({ error: 'Email is required.' });
        return;
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const requestedRoles = normalizeRoles(
        Array.isArray(roles) ? (roles as UserRole[]) : undefined,
        role && ['student', 'staff', 'admin'].includes(role) ? (role as UserRole) : 'staff'
      );

      // If user already exists (e.g., an existing PAU student), update their roles instead of duplicating
      const existing = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
      if (existing) {
        const merged = normalizeRoles([...getUserRoles(existing), ...requestedRoles]);
        existing.roles = merged;
        existing.role = getPrimaryRole(merged);
        if (department && !existing.department) {
          existing.department = String(department).trim();
        }
        if (existing.status === 'suspended') {
          existing.status = 'active';
        }
        saveDatabase();
        res.status(200).json({
          user: sanitizeUser(existing),
          mergedExisting: true,
        });
        return;
      }

      if (!name) {
        res.status(400).json({ error: 'Full name is required when creating a new staff account.' });
        return;
      }

      const initialPassword =
        typeof password === 'string' && password.trim().length >= 6
          ? password.trim()
          : 'printhaus123';

      const newUser: UserAccount = {
        id: `usr_${crypto.randomUUID().slice(0, 8)}`,
        name: String(name).trim(),
        email: normalizedEmail,
        passwordHash: hashPasswordScrypt(initialPassword),
        department: String(department || 'Print Operations & Pickup Desk').trim(),
        matricNumber: matricNumber ? String(matricNumber).trim() : undefined,
        residency: residency === 'on-campus' ? 'on-campus' : 'off-campus',
        role: getPrimaryRole(requestedRoles),
        roles: requestedRoles,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      db.users.push(newUser);
      saveDatabase();
      res.status(201).json({
        user: sanitizeUser(newUser),
        mergedExisting: false,
      });
    }
  );

  app.patch(
    '/api/admin/users/:id/roles',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const user = db.users.find((u) => u.id === req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const rawRoles = req.body?.roles;
      if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
        res.status(400).json({ error: 'At least one valid role (student, staff, or admin) is required.' });
        return;
      }

      const nextRoles = normalizeRoles(rawRoles as UserRole[]);
      if (user.id === req.authUser!.id && !nextRoles.includes('admin')) {
        res.status(400).json({ error: 'You cannot remove your own admin permission.' });
        return;
      }

      user.roles = nextRoles;
      user.role = getPrimaryRole(nextRoles);
      saveDatabase();
      res.json({ user: sanitizeUser(user) });
    }
  );

  app.patch(
    '/api/admin/users/:id',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const user = db.users.find((u) => u.id === req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const { status, role, roles, department } = req.body ?? {};
      if (status === 'active' || status === 'suspended') {
        if (user.id === req.authUser!.id && status === 'suspended') {
          res.status(400).json({ error: 'You cannot deactivate your own active admin account.' });
          return;
        }
        user.status = status;
      }

      if (Array.isArray(roles) && roles.length > 0) {
        const nextRoles = normalizeRoles(roles as UserRole[]);
        if (user.id === req.authUser!.id && !nextRoles.includes('admin')) {
          res.status(400).json({ error: 'You cannot remove your own admin permission.' });
          return;
        }
        user.roles = nextRoles;
        user.role = getPrimaryRole(nextRoles);
      } else if (role === 'student' || role === 'staff' || role === 'admin') {
        const nextRoles = normalizeRoles([role]);
        user.roles = nextRoles;
        user.role = getPrimaryRole(nextRoles);
      }

      if (typeof department === 'string' && department.trim()) {
        user.department = department.trim();
      }

      saveDatabase();
      res.json({ user: sanitizeUser(user) });
    }
  );

  app.get(
    '/api/admin/partners',
    requireAuth,
    requireRole('staff', 'admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      res.json({ partners: db.partners });
    }
  );

  app.patch(
    '/api/admin/partners/:id',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const partner = db.partners.find((p) => p.id === req.params.id);
      if (!partner) {
        res.status(404).json({ error: 'Partner not found.' });
        return;
      }
      const { status, turnaroundMinutes, costPerBwPage, costPerColorPage } = req.body ?? {};
      if (['available', 'busy', 'offline'].includes(status)) partner.status = status;
      if (typeof turnaroundMinutes === 'number') partner.turnaroundMinutes = turnaroundMinutes;
      if (typeof costPerBwPage === 'number') partner.costPerBwPage = costPerBwPage;
      if (typeof costPerColorPage === 'number') partner.costPerColorPage = costPerColorPage;
      saveDatabase();
      res.json({ partner });
    }
  );

  app.get('/api/complaints', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const authUser = req.authUser!;
    const { studentId } = req.query;
    const isPrivileged = userHasRole(authUser, 'staff') || userHasRole(authUser, 'admin');

    const list =
      !isPrivileged || studentId === authUser.id
        ? db.complaints.filter((c) => c.studentId === authUser.id)
        : studentId
          ? db.complaints.filter((c) => c.studentId === String(studentId))
          : db.complaints;
    res.json({ complaints: list });
  });

  app.post('/api/complaints', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const authUser = req.authUser!;
    const { orderId, subject, description } = req.body ?? {};
    const order = db.orders.find((o) => o.id === orderId || o.orderCode === orderId);
    if (!order || !subject || !description) {
      res.status(400).json({ error: 'Order, subject, and description are required.' });
      return;
    }
    if (order.studentId !== authUser.id && !userHasRole(authUser, 'admin')) {
      res.status(403).json({ error: 'Forbidden: you can only file support tickets for your own orders.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const ticket = {
      id: `cmp_${crypto.randomUUID().slice(0, 8)}`,
      orderId: order.id,
      orderCode: order.orderCode,
      studentId: order.studentId,
      studentName: order.studentName,
      subject: String(subject).trim(),
      description: String(description).trim(),
      status: 'open' as const,
      resolutionNote: null,
      refundAmount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    db.complaints.unshift(ticket);
    saveDatabase();
    res.status(201).json({ complaint: ticket });
  });

  app.patch(
    '/api/complaints/:id',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const db = getDb();
      const ticket = db.complaints.find((c) => c.id === req.params.id);
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found.' });
        return;
      }
      const { status, resolutionNote, refundAmount } = req.body ?? {};
      if (['open', 'resolved', 'refunded'].includes(status)) ticket.status = status;
      if (resolutionNote !== undefined) ticket.resolutionNote = String(resolutionNote);
      if (typeof refundAmount === 'number') ticket.refundAmount = Math.max(0, refundAmount);

      if (ticket.status === 'refunded') {
        const order = db.orders.find((o) => o.id === ticket.orderId);
        if (order) {
          order.paymentStatus = 'refunded';
          order.updatedAt = new Date().toISOString();
        }
        db.notifications.unshift({
          id: `ntf_${crypto.randomUUID().slice(0, 8)}`,
          userId: ticket.studentId,
          orderCode: ticket.orderCode,
          title: `Refund issued for ${ticket.orderCode}`,
          message: `₦${ticket.refundAmount} refunded: ${ticket.resolutionNote || 'Approved by PrintHaus Admin.'}`,
          read: false,
          createdAt: new Date().toISOString(),
        });
      }

      ticket.updatedAt = new Date().toISOString();
      saveDatabase();
      res.json({ complaint: ticket });
    }
  );

  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const authUser = req.authUser!;
    const { userId } = req.query;
    const isAdmin = userHasRole(authUser, 'admin');
    const targetUserId = isAdmin && userId ? String(userId) : authUser.id;
    const list = db.notifications.filter((n) => n.userId === targetUserId);
    res.json({ notifications: list });
  });

  app.patch('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const authUser = req.authUser!;
    const item = db.notifications.find((n) => n.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    if (item.userId !== authUser.id && !userHasRole(authUser, 'admin')) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }
    item.read = true;
    saveDatabase();
    res.json({ ok: true });
  });

  // --- VITE / STATIC SERVING ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PrintHaus full-stack server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start PrintHaus server:', err);
  process.exit(1);
});
