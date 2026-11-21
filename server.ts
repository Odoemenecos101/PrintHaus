import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
import {
  generateOrderCodes,
  getDb,
  getStatusLabel,
  getUploadsDir,
  hashPassword,
  initDatabase,
  saveDatabase,
} from './server/store';
import {
  BindingOption,
  ColorMode,
  OrderDocumentItemInput,
  OrderStatus,
  PaymentMethod,
  PrintOrder,
  SidedMode,
  UserAccount,
  calculateMultiDocumentOrderPricing,
  getSchoolForProgramme,
} from './src/types/printhaus';

const PORT = 3000;

async function startServer() {
  await initDatabase();

  const app = express();
  app.use(express.json({ limit: '30mb' }));

  const sanitizeUser = (u: UserAccount) => {
    const { passwordHash: _ignored, ...safe } = u;
    return safe;
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

    const db = getDb();
    const normalizedEmail = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const prog = department ? String(department).trim() : 'Computer Science';
    const isCampus = residency === 'on-campus';

    const newUser: UserAccount = {
      id: `usr_${crypto.randomUUID().slice(0, 8)}`,
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(String(password)),
      matricNumber: matricNumber ? String(matricNumber).trim() : 'PAU-NEW',
      school: school ? String(school).trim() : getSchoolForProgramme(prog),
      department: prog,
      residency: isCampus ? 'on-campus' : 'off-campus',
      hostelGender: isCampus ? (hostelGender === 'female' ? 'female' : 'male') : undefined,
      hostelName: isCampus && hostelName ? String(hostelName).trim() : undefined,
      role: 'student',
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);
    saveDatabase();
    res.status(201).json({ user: sanitizeUser(newUser) });
  });

  app.patch('/api/users/:id/profile', (req: Request, res: Response) => {
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

    if (!user || user.passwordHash !== hashPassword(String(password ?? ''))) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (user.status === 'suspended') {
      res.status(403).json({ error: 'This account has been suspended. Contact PrintHaus Admin.' });
      return;
    }

    res.json({ user: sanitizeUser(user) });
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

  app.put('/api/pricing', (req: Request, res: Response) => {
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
  app.post('/api/documents/upload', async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType, base64Data, uploadedBy, fallbackPageCount } = req.body ?? {};
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
          // Regex fallback for non-standard PDFs
          const text = buffer.toString('latin1');
          const matches = text.match(/\/Type\s*\/Page[^s]/g);
          if (matches && matches.length > 0) pageCount = matches.length;
        }
      } else if (lowerName.endsWith('.txt')) {
        const lines = buffer.toString('utf-8').split('\n').length;
        pageCount = Math.max(1, Math.ceil(lines / 42));
      } else if (lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) {
        // Estimate reasonable page count from Word XML/binary size if user didn't specify
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
        uploadedBy: String(uploadedBy || 'guest'),
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

  app.get('/api/documents/:id/file', (req: Request, res: Response) => {
    const db = getDb();
    const doc = db.documents.find((d) => d.id === req.params.id);
    if (!doc || !fs.existsSync(doc.storagePath)) {
      res.status(404).json({ error: 'Document file not found.' });
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
  app.get('/api/orders', (req: Request, res: Response) => {
    const db = getDb();
    const { studentId, status } = req.query;
    let list = [...db.orders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (studentId) {
      list = list.filter((o) => o.studentId === String(studentId));
    }
    if (status && status !== 'all') {
      list = list.filter((o) => o.status === String(status));
    }
    res.json({ orders: list });
  });

  app.get('/api/orders/track/:code', (req: Request, res: Response) => {
    const db = getDb();
    const q = String(req.params.code).trim().toUpperCase();
    const order = db.orders.find(
      (o) => o.orderCode.toUpperCase() === q || o.collectionCode.toUpperCase() === q
    );
    if (!order) {
      res.status(404).json({ error: `No order found matching "${q}".` });
      return;
    }
    res.json({ order });
  });

  app.post('/api/orders', (req: Request, res: Response) => {
    const db = getDb();
    const {
      studentId,
      studentName,
      studentEmail,
      matricNumber,
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

    if (!studentId || rawItems.length === 0) {
      res.status(400).json({ error: 'Student account and at least one uploaded document are required.' });
      return;
    }

    const existingStudentOrders = db.orders.filter((o) => o.studentId === studentId);
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

    const { orderCode, collectionCode } = generateOrderCodes(db.orders);
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
        actor: String(studentName || 'Student'),
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
      studentId: String(studentId),
      studentName: String(studentName || 'PAU Student'),
      studentEmail: String(studentEmail || ''),
      matricNumber: String(matricNumber || 'PAU-STD'),
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

  app.patch('/api/orders/:id/payment', (req: Request, res: Response) => {
    const db = getDb();
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const { actor = 'Printing Staff' } = req.body ?? {};
    const nowIso = new Date().toISOString();
    order.paymentStatus = 'confirmed';
    if (order.status === 'order_received') {
      order.status = 'payment_confirmed';
      order.statusHistory.push({
        status: 'payment_confirmed',
        label: 'Payment confirmed',
        note: `Transfer reference ${order.paymentReference} verified.`,
        actor: String(actor),
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
  });

  app.patch('/api/orders/:id/status', (req: Request, res: Response) => {
    const db = getDb();
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const { status, note, actor = 'Printing Staff', qualityChecklist, pickupShelf, assignedPartnerId, rejectionReason } =
      req.body ?? {};
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

      if (nextStatus === 'collected') {
        const partner = db.partners.find((p) => p.id === order.assignedPartnerId);
        if (partner) partner.ordersCompleted += 1;
      }

      order.statusHistory.push({
        status: nextStatus,
        label: getStatusLabel(nextStatus),
        note:
          String(note || '').trim() ||
          (nextStatus === 'ready_for_collection'
            ? `Packaged and placed at ${order.pickupVenue} (${order.pickupShelf}).`
            : `Updated to ${getStatusLabel(nextStatus)}.`),
        actor: String(actor),
        timestamp: nowIso,
      });

      const titleMap: Partial<Record<OrderStatus, string>> = {
        printing_in_progress: `Printing started for ${order.orderCode}`,
        quality_check: `Quality inspection underway for ${order.orderCode}`,
        ready_for_collection: `${order.orderCode} is ready at ${order.pickupVenue}`,
        collected: `Order ${order.orderCode} collected`,
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
              ? `Collect anytime during operating hours at ${order.pickupVenue} (${order.pickupShelf}) with code ${order.collectionCode}.`
              : String(note || `Order status is now ${getStatusLabel(nextStatus)}.`),
          read: false,
          createdAt: nowIso,
        });
      }
    }

    order.updatedAt = nowIso;
    saveDatabase();
    res.json({ order });
  });

  app.post('/api/orders/verify-collection', (req: Request, res: Response) => {
    const db = getDb();
    const { code, actor = 'Pickup Attendant' } = req.body ?? {};
    const q = String(code ?? '').trim().toUpperCase();
    const order = db.orders.find(
      (o) => o.collectionCode.toUpperCase() === q || o.orderCode.toUpperCase() === q
    );
    if (!order) {
      res.status(404).json({ error: `No order matches code "${q}".` });
      return;
    }
    if (order.status === 'collected') {
      res.status(409).json({ error: `Order ${order.orderCode} was already collected.`, order });
      return;
    }

    const nowIso = new Date().toISOString();
    order.status = 'collected';
    order.updatedAt = nowIso;
    order.statusHistory.push({
      status: 'collected',
      label: 'Collected',
      note: `Collection code ${order.collectionCode} verified at PAU Pickup Counter.`,
      actor: String(actor),
      timestamp: nowIso,
    });

    db.notifications.unshift({
      id: `ntf_${crypto.randomUUID().slice(0, 8)}`,
      userId: order.studentId,
      orderCode: order.orderCode,
      title: `Order ${order.orderCode} collected`,
      message: `Thank you for using PrintHaus! Receipt is available in your order history.`,
      read: false,
      createdAt: nowIso,
    });

    saveDatabase();
    res.json({ order });
  });

  // --- STAFF SUPPLIES ---
  app.get('/api/staff/supplies', (_req: Request, res: Response) => {
    const db = getDb();
    res.json({ supplies: db.supplies });
  });

  app.patch('/api/staff/supplies/:id', (req: Request, res: Response) => {
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
  });

  // --- ADMIN: OVERVIEW, USERS, PARTNERS, COMPLAINTS ---
  app.get('/api/admin/overview', (_req: Request, res: Response) => {
    const db = getDb();
    const activeOrders = db.orders.filter((o) => o.status !== 'rejected' && o.paymentStatus !== 'refunded');
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
        activeQueueCount: db.orders.filter((o) => !['collected', 'rejected'].includes(o.status)).length,
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
  });

  app.get('/api/admin/users', (_req: Request, res: Response) => {
    const db = getDb();
    res.json({ users: db.users.map(sanitizeUser) });
  });

  app.post('/api/admin/users', (req: Request, res: Response) => {
    const db = getDb();
    const { name, email, role, department, matricNumber, residency } = req.body ?? {};
    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required.' });
      return;
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: 'Email already exists.' });
      return;
    }
    const newUser: UserAccount = {
      id: `usr_${crypto.randomUUID().slice(0, 8)}`,
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash: hashPassword('printhaus123'),
      department: String(department || 'Print Operations'),
      matricNumber: matricNumber ? String(matricNumber).trim() : undefined,
      residency: residency === 'on-campus' ? 'on-campus' : 'off-campus',
      role: ['student', 'staff', 'admin'].includes(role) ? role : 'staff',
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    db.users.push(newUser);
    saveDatabase();
    res.status(201).json({ user: sanitizeUser(newUser) });
  });

  app.patch('/api/admin/users/:id', (req: Request, res: Response) => {
    const db = getDb();
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const { status, role } = req.body ?? {};
    if (status === 'active' || status === 'suspended') user.status = status;
    if (role === 'student' || role === 'staff' || role === 'admin') user.role = role;
    saveDatabase();
    res.json({ user: sanitizeUser(user) });
  });

  app.get('/api/admin/partners', (_req: Request, res: Response) => {
    const db = getDb();
    res.json({ partners: db.partners });
  });

  app.patch('/api/admin/partners/:id', (req: Request, res: Response) => {
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
  });

  app.get('/api/complaints', (req: Request, res: Response) => {
    const db = getDb();
    const { studentId } = req.query;
    const list = studentId
      ? db.complaints.filter((c) => c.studentId === String(studentId))
      : db.complaints;
    res.json({ complaints: list });
  });

  app.post('/api/complaints', (req: Request, res: Response) => {
    const db = getDb();
    const { orderId, studentId, subject, description } = req.body ?? {};
    const order = db.orders.find((o) => o.id === orderId || o.orderCode === orderId);
    if (!order || !subject || !description) {
      res.status(400).json({ error: 'Order, subject, and description are required.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const ticket = {
      id: `cmp_${crypto.randomUUID().slice(0, 8)}`,
      orderId: order.id,
      orderCode: order.orderCode,
      studentId: String(studentId || order.studentId),
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

  app.patch('/api/complaints/:id', (req: Request, res: Response) => {
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
  });

  app.get('/api/notifications', (req: Request, res: Response) => {
    const db = getDb();
    const { userId } = req.query;
    const list = userId
      ? db.notifications.filter((n) => n.userId === String(userId))
      : db.notifications;
    res.json({ notifications: list });
  });

  app.patch('/api/notifications/:id/read', (req: Request, res: Response) => {
    const db = getDb();
    const item = db.notifications.find((n) => n.id === req.params.id);
    if (item) {
      item.read = true;
      saveDatabase();
    }
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
