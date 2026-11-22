import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  ComplaintTicket,
  OrderNotification,
  OrderStatus,
  PrintOrder,
  PricingConfig,
  PrintingPartner,
  SupplyItem,
  UserAccount,
  calculateMultiDocumentOrderPricing,
} from '../src/types/printhaus';

export interface UploadedDocumentRecord {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  pageCount: number;
  storagePath: string;
  uploadedBy: string;
  createdAt: string;
}

export interface PrintHausDatabase {
  users: UserAccount[];
  pricing: PricingConfig;
  partners: PrintingPartner[];
  supplies: SupplyItem[];
  documents: UploadedDocumentRecord[];
  orders: PrintOrder[];
  notifications: OrderNotification[];
  complaints: ComplaintTicket[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const DB_FILE = path.join(DATA_DIR, 'printhaus-db.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(`printhaus-pau:${password}`).digest('hex');
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash) return false;
  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }
  const legacy = Buffer.from(hashPassword(password), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (legacy.length !== expected.length) return false;
  return crypto.timingSafeEqual(legacy, expected);
}

async function createSamplePdf(filePath: string, title: string, lines: string[], pageCount: number) {
  if (fs.existsSync(filePath)) return;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.addPage([595, 842]);
    page.drawText('PAN-ATLANTIC UNIVERSITY — PRINTHAUS SAMPLE DOCUMENT', {
      x: 50,
      y: 785,
      size: 10,
      font: boldFont,
      color: rgb(0.12, 0.25, 0.54),
    });
    page.drawText(title, {
      x: 50,
      y: 750,
      size: 18,
      font: boldFont,
      color: rgb(0.08, 0.1, 0.14),
    });
    page.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: 50,
      y: 725,
      size: 11,
      font,
      color: rgb(0.4, 0.45, 0.5),
    });

    let y = 685;
    for (const line of lines) {
      page.drawText(line, {
        x: 50,
        y,
        size: 12,
        font,
        color: rgb(0.15, 0.18, 0.22),
      });
      y -= 22;
    }
  }

  const bytes = await pdfDoc.save();
  fs.writeFileSync(filePath, bytes);
}

function buildInitialDatabase(): PrintHausDatabase {
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString();

  const pricing: PricingConfig = {
    bwSinglePerPage: 200,
    bwDoublePerPage: 180,
    colorSinglePerPage: 350,
    colorDoublePerPage: 300,
    stapling: 100,
    spiralBinding: 1000,
    laminationPerPage: 150,
    urgentFee: 200,
    packagingFee: 50,
    operatingCostPerOrder: 50,
    partnerBwRate: 120,
    partnerColorRate: 220,
    firstOrderDiscountPct: 10,
    bulkThresholdDocuments: 3,
    bulkDiscountPct: 15,
    updatedAt: hoursAgo(24),
  };

  const users: UserAccount[] = [
    {
      id: 'usr_student_1',
      name: 'Chidinma Okafor',
      email: 'chidinma.okafor@pau.edu.ng',
      passwordHash: hashPassword('student123'),
      matricNumber: '22120612944',
      school: 'School of Science and Technology',
      department: 'Computer Science',
      residency: 'off-campus',
      role: 'student',
      status: 'active',
      createdAt: hoursAgo(240),
    },
    {
      id: 'usr_student_2',
      name: 'Toluwanimi Adeyemi',
      email: 'tolu.adeyemi@pau.edu.ng',
      passwordHash: hashPassword('student123'),
      matricNumber: '21110311408',
      school: 'School of Management and Social Sciences',
      department: 'Accounting',
      residency: 'on-campus',
      hostelGender: 'female',
      hostelName: 'Cooperative Queens Hostel',
      role: 'student',
      status: 'active',
      createdAt: hoursAgo(180),
    },
    {
      id: 'usr_student_3',
      name: 'Ibrahim Bello',
      email: 'ibrahim.bello@pau.edu.ng',
      passwordHash: hashPassword('student123'),
      matricNumber: '23140210815',
      school: 'School of Media and Communication',
      department: 'Mass Communication',
      residency: 'on-campus',
      hostelGender: 'male',
      hostelName: 'Emerald Hostel',
      role: 'student',
      status: 'active',
      createdAt: hoursAgo(120),
    },
    {
      id: 'usr_staff_1',
      name: 'Emeka Nwosu',
      email: 'staff@printhaus.ng',
      passwordHash: hashPassword('staff123'),
      department: 'Print Operations & Pickup Desk',
      role: 'staff',
      status: 'active',
      createdAt: hoursAgo(400),
    },
    {
      id: 'usr_admin_1',
      name: 'Amara Eze',
      email: 'admin@printhaus.ng',
      passwordHash: hashPassword('admin123'),
      department: 'Executive Operations',
      role: 'admin',
      status: 'active',
      createdAt: hoursAgo(500),
    },
  ];

  const partners: PrintingPartner[] = [
    {
      id: 'ptr_primary',
      name: 'Lekki Academic Press (Primary)',
      type: 'primary',
      location: 'Ibeju-Lekki Campus Gate Annex (4 mins walk)',
      contactPhone: '+234 803 412 8890',
      turnaroundMinutes: 35,
      costPerBwPage: 120,
      costPerColorPage: 220,
      status: 'available',
      ordersCompleted: 142,
    },
    {
      id: 'ptr_backup',
      name: 'Sangotedo Digital Print Hub (Backup)',
      type: 'backup',
      location: 'Km 46 Lekki-Epe Expressway',
      contactPhone: '+234 809 774 3102',
      turnaroundMinutes: 60,
      costPerBwPage: 130,
      costPerColorPage: 240,
      status: 'available',
      ordersCompleted: 27,
    },
  ];

  const supplies: SupplyItem[] = [
    {
      id: 'sup_1',
      name: '80gsm A4 Copy Paper (500-sheet ream)',
      category: 'paper',
      quantity: 38,
      unit: 'reams',
      minThreshold: 12,
      location: 'Primary Press + Pickup Desk',
      updatedAt: hoursAgo(3),
    },
    {
      id: 'sup_2',
      name: 'Black Laser Toner Cartridges (High Yield)',
      category: 'toner',
      quantity: 6,
      unit: 'cartridges',
      minThreshold: 3,
      location: 'Primary Press',
      updatedAt: hoursAgo(6),
    },
    {
      id: 'sup_3',
      name: 'CMYK Colour Toner Set',
      category: 'toner',
      quantity: 2,
      unit: 'sets',
      minThreshold: 2,
      location: 'Primary Press',
      updatedAt: hoursAgo(8),
    },
    {
      id: 'sup_4',
      name: '12mm Black Spiral Binding Coils',
      category: 'binding',
      quantity: 95,
      unit: 'coils',
      minThreshold: 30,
      location: 'Finishing Bench',
      updatedAt: hoursAgo(5),
    },
    {
      id: 'sup_5',
      name: 'Kraft A4 Pickup Envelopes (Labelled)',
      category: 'packaging',
      quantity: 160,
      unit: 'envelopes',
      minThreshold: 50,
      location: 'PAU Pickup Counter',
      updatedAt: hoursAgo(2),
    },
  ];

  const documents: UploadedDocumentRecord[] = [
    {
      id: 'doc_sample_1',
      fileName: 'CSC402_Distributed_Systems_Assignment.pdf',
      mimeType: 'application/pdf',
      size: 248320,
      pageCount: 20,
      storagePath: path.join(UPLOADS_DIR, 'doc_sample_1.pdf'),
      uploadedBy: 'usr_student_1',
      createdAt: hoursAgo(14),
    },
    {
      id: 'doc_sample_2',
      fileName: 'ACC411_Final_Year_Project_Draft.pdf',
      mimeType: 'application/pdf',
      size: 1124000,
      pageCount: 44,
      storagePath: path.join(UPLOADS_DIR, 'doc_sample_2.pdf'),
      uploadedBy: 'usr_student_2',
      createdAt: hoursAgo(5),
    },
    {
      id: 'doc_sample_3',
      fileName: 'MCM305_Media_Campaign_Slides.pdf',
      mimeType: 'application/pdf',
      size: 642000,
      pageCount: 16,
      storagePath: path.join(UPLOADS_DIR, 'doc_sample_3.pdf'),
      uploadedBy: 'usr_student_3',
      createdAt: hoursAgo(2),
    },
  ];

  const specs1 = {
    copies: 1,
    colorMode: 'bw' as const,
    sided: 'single' as const,
    binding: 'none' as const,
    lamination: false,
    urgent: false,
    notes: 'Please staple top-left if possible.',
  };
  const calc1 = calculateMultiDocumentOrderPricing(
    [
      {
        documentId: 'doc_sample_1',
        fileName: 'CSC402_Distributed_Systems_Assignment.pdf',
        fileSize: 248320,
        fileType: 'application/pdf',
        pageCount: 20,
        recipientLabel: 'Chidinma (Self)',
        specs: specs1,
      },
    ],
    pricing,
    false
  );

  const specs2 = {
    copies: 1,
    colorMode: 'bw' as const,
    sided: 'double' as const,
    binding: 'spiral' as const,
    lamination: false,
    urgent: false,
    notes: 'Clear acetate front cover for supervisor review.',
  };
  const calc2 = calculateMultiDocumentOrderPricing(
    [
      {
        documentId: 'doc_sample_2',
        fileName: 'ACC411_Final_Year_Project_Draft.pdf',
        fileSize: 1124000,
        fileType: 'application/pdf',
        pageCount: 44,
        recipientLabel: 'Toluwanimi (Self)',
        specs: specs2,
      },
    ],
    pricing,
    false
  );

  const specs3 = {
    copies: 2,
    colorMode: 'color' as const,
    sided: 'single' as const,
    binding: 'stapling' as const,
    lamination: false,
    urgent: true,
    notes: 'Needed before 12:00 PM seminar presentation.',
  };
  const specs3Friend = {
    copies: 1,
    colorMode: 'bw' as const,
    sided: 'double' as const,
    binding: 'spiral' as const,
    lamination: false,
    urgent: false,
    notes: 'Spiral bind friend copy separately.',
  };
  const calc3 = calculateMultiDocumentOrderPricing(
    [
      {
        documentId: 'doc_sample_3',
        fileName: 'MCM305_Media_Campaign_Slides.pdf',
        fileSize: 642000,
        fileType: 'application/pdf',
        pageCount: 16,
        recipientLabel: 'Ibrahim (Self)',
        specs: specs3,
      },
      {
        documentId: 'doc_sample_1',
        fileName: 'CSC402_Distributed_Systems_Assignment.pdf',
        fileSize: 248320,
        fileType: 'application/pdf',
        pageCount: 20,
        recipientLabel: 'Friend — Tunde',
        specs: specs3Friend,
      },
    ],
    pricing,
    false
  );

  const orders: PrintOrder[] = [
    {
      id: 'ord_2048',
      orderCode: 'PH-2048',
      collectionCode: 'PAU-7392',
      studentId: 'usr_student_1',
      studentName: 'Chidinma Okafor',
      studentEmail: 'chidinma.okafor@pau.edu.ng',
      matricNumber: '22120612944',
      documentId: 'doc_sample_1',
      fileName: 'CSC402_Distributed_Systems_Assignment.pdf',
      fileSize: 248320,
      fileType: 'application/pdf',
      pageCount: 20,
      specs: specs1,
      items: calc1.computedItems,
      pricingBreakdown: calc1.breakdown,
      paymentMethod: 'paystack_card',
      paymentStatus: 'confirmed',
      paymentReference: 'PSK-904821A',
      status: 'ready_for_collection',
      statusHistory: [
        {
          status: 'order_received',
          label: 'Order received',
          note: 'Uploaded by Chidinma Okafor (off-campus evening order).',
          actor: 'Chidinma Okafor',
          timestamp: hoursAgo(14),
        },
        {
          status: 'payment_confirmed',
          label: 'Payment confirmed',
          note: 'Paystack reference PSK-904821A verified.',
          actor: 'System',
          timestamp: hoursAgo(13.9),
        },
        {
          status: 'printing_in_progress',
          label: 'Printing in progress',
          note: 'Routed to Lekki Academic Press.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(3.5),
        },
        {
          status: 'quality_check',
          label: 'Quality check',
          note: 'All 20 pages verified for legibility and sequence.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(2.8),
        },
        {
          status: 'ready_for_collection',
          label: 'Ready for collection',
          note: 'Sealed in Kraft sleeve and placed in Cubby A-04.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(2.4),
        },
      ],
      qualityChecklist: {
        correctDocument: true,
        correctCopies: true,
        correctPageCount: true,
        correctFormat: true,
        printQuality: true,
        packagedAndLabeled: true,
      },
      assignedPartnerId: 'ptr_primary',
      assignedPartnerName: 'Lekki Academic Press (Primary)',
      pickupVenue: 'Security Post in TYD',
      pickupSlot: 'Anytime during operating hours',
      pickupShelf: 'Cubby A-04',
      rejectionReason: null,
      createdAt: hoursAgo(14),
      updatedAt: hoursAgo(2.4),
    },
    {
      id: 'ord_2049',
      orderCode: 'PH-2049',
      collectionCode: 'PAU-4185',
      studentId: 'usr_student_2',
      studentName: 'Toluwanimi Adeyemi',
      studentEmail: 'tolu.adeyemi@pau.edu.ng',
      matricNumber: '21110311408',
      documentId: 'doc_sample_2',
      fileName: 'ACC411_Final_Year_Project_Draft.pdf',
      fileSize: 1124000,
      fileType: 'application/pdf',
      pageCount: 44,
      specs: specs2,
      items: calc2.computedItems,
      pricingBreakdown: calc2.breakdown,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'confirmed',
      paymentReference: 'TRF-449102',
      status: 'printing_in_progress',
      statusHistory: [
        {
          status: 'order_received',
          label: 'Order received',
          note: 'Spiral bound project draft submitted.',
          actor: 'Toluwanimi Adeyemi',
          timestamp: hoursAgo(5),
        },
        {
          status: 'payment_confirmed',
          label: 'Payment confirmed',
          note: 'Bank transfer TRF-449102 verified by staff.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(4.2),
        },
        {
          status: 'printing_in_progress',
          label: 'Printing in progress',
          note: 'Double-sided print run underway at primary partner.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(1.5),
        },
      ],
      qualityChecklist: {
        correctDocument: false,
        correctCopies: false,
        correctPageCount: false,
        correctFormat: false,
        printQuality: false,
        packagedAndLabeled: false,
      },
      assignedPartnerId: 'ptr_primary',
      assignedPartnerName: 'Lekki Academic Press (Primary)',
      pickupVenue: 'Cooperative Queens Hostel',
      pickupSlot: 'Anytime during operating hours',
      pickupShelf: null,
      rejectionReason: null,
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(1.5),
    },
    {
      id: 'ord_2050',
      orderCode: 'PH-2050',
      collectionCode: 'PAU-6021',
      studentId: 'usr_student_3',
      studentName: 'Ibrahim Bello',
      studentEmail: 'ibrahim.bello@pau.edu.ng',
      matricNumber: '23140210815',
      documentId: 'doc_sample_3',
      fileName: 'MCM305_Media_Campaign_Slides.pdf + 1 more',
      fileSize: 890320,
      fileType: 'application/pdf',
      pageCount: 36,
      specs: specs3,
      items: calc3.computedItems,
      pricingBreakdown: calc3.breakdown,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'pending',
      paymentReference: 'TRF-882019',
      status: 'order_received',
      statusHistory: [
        {
          status: 'order_received',
          label: 'Order received',
          note: 'Awaiting staff verification of bank transfer TRF-882019.',
          actor: 'Ibrahim Bello',
          timestamp: hoursAgo(0.7),
        },
      ],
      qualityChecklist: {
        correctDocument: false,
        correctCopies: false,
        correctPageCount: false,
        correctFormat: false,
        printQuality: false,
        packagedAndLabeled: false,
      },
      assignedPartnerId: 'ptr_primary',
      assignedPartnerName: 'Lekki Academic Press (Primary)',
      pickupVenue: 'Emerald Hostel',
      pickupSlot: 'Anytime during operating hours',
      pickupShelf: null,
      rejectionReason: null,
      createdAt: hoursAgo(0.7),
      updatedAt: hoursAgo(0.7),
    },
    {
      id: 'ord_2045',
      orderCode: 'PH-2045',
      collectionCode: 'PAU-1940',
      studentId: 'usr_student_1',
      studentName: 'Chidinma Okafor',
      studentEmail: 'chidinma.okafor@pau.edu.ng',
      matricNumber: '22120612944',
      documentId: 'doc_sample_1',
      fileName: 'ENT301_Feasibility_Study_Notes.pdf',
      fileSize: 185400,
      fileType: 'application/pdf',
      pageCount: 20,
      specs: specs1,
      items: calc1.computedItems,
      pricingBreakdown: calc1.breakdown,
      paymentMethod: 'paystack_card',
      paymentStatus: 'confirmed',
      paymentReference: 'PSK-881203Z',
      status: 'collected',
      statusHistory: [
        {
          status: 'order_received',
          label: 'Order received',
          note: 'Submitted online.',
          actor: 'Chidinma Okafor',
          timestamp: hoursAgo(50),
        },
        {
          status: 'payment_confirmed',
          label: 'Payment confirmed',
          note: 'Paystack verified.',
          actor: 'System',
          timestamp: hoursAgo(49.9),
        },
        {
          status: 'printing_in_progress',
          label: 'Printing in progress',
          note: 'Sent to primary press.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(48),
        },
        {
          status: 'quality_check',
          label: 'Quality check',
          note: 'Passed all 6 checks.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(47.4),
        },
        {
          status: 'ready_for_collection',
          label: 'Ready for collection',
          note: 'Placed in Cubby B-02.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(47),
        },
        {
          status: 'collected',
          label: 'Collected',
          note: 'Verified code PAU-1940 at PAU Central Pickup Counter.',
          actor: 'Emeka Nwosu',
          timestamp: hoursAgo(44),
        },
      ],
      qualityChecklist: {
        correctDocument: true,
        correctCopies: true,
        correctPageCount: true,
        correctFormat: true,
        printQuality: true,
        packagedAndLabeled: true,
      },
      assignedPartnerId: 'ptr_primary',
      assignedPartnerName: 'Lekki Academic Press (Primary)',
      pickupVenue: "Student's Centre",
      pickupSlot: 'Anytime during operating hours',
      pickupShelf: 'Cubby B-02',
      rejectionReason: null,
      createdAt: hoursAgo(50),
      updatedAt: hoursAgo(44),
    },
  ];

  const notifications: OrderNotification[] = [
    {
      id: 'ntf_1',
      userId: 'usr_student_1',
      orderCode: 'PH-2048',
      title: 'Ready for collection at Security Post in TYD',
      message:
        'Your order PH-2048 (CSC402_Distributed_Systems_Assignment.pdf) is ready in Cubby A-04 at Security Post in TYD. Present code PAU-7392 to collect.',
      read: false,
      createdAt: hoursAgo(2.4),
    },
    {
      id: 'ntf_2',
      userId: 'usr_student_2',
      orderCode: 'PH-2049',
      title: 'Printing in progress',
      message: 'ACC411_Final_Year_Project_Draft.pdf is currently being printed and spiral-bound.',
      read: false,
      createdAt: hoursAgo(1.5),
    },
  ];

  const complaints: ComplaintTicket[] = [
    {
      id: 'cmp_1',
      orderId: 'ord_2045',
      orderCode: 'PH-2045',
      studentId: 'usr_student_1',
      studentName: 'Chidinma Okafor',
      subject: 'Slightly bent corner on page 19',
      description: 'The print quality was clear, though page 19 had a small fold in the corner.',
      status: 'resolved',
      resolutionNote: 'Added extra Kraft backing board to future single-sided sleeves.',
      refundAmount: 0,
      createdAt: hoursAgo(42),
      updatedAt: hoursAgo(38),
    },
  ];

  return {
    users,
    pricing,
    partners,
    supplies,
    documents,
    orders,
    notifications,
    complaints,
  };
}

let dbCache: PrintHausDatabase | null = null;

export async function initDatabase(): Promise<PrintHausDatabase> {
  ensureDirs();

  // Ensure sample PDFs exist on disk so staff download & student preview work immediately
  await Promise.all([
    createSamplePdf(
      path.join(UPLOADS_DIR, 'doc_sample_1.pdf'),
      'CSC 402 — Distributed Systems & Consensus Notes',
      [
        'Student: Chidinma Okafor (22120612944)',
        'Department of Computer Science, Pan-Atlantic University',
        'Topic: Raft Consensus, Vector Clocks & Fault-Tolerant Replication',
        'Format: 20 pages, Black & White, Single-sided 80gsm A4',
      ],
      20
    ),
    createSamplePdf(
      path.join(UPLOADS_DIR, 'doc_sample_2.pdf'),
      'ACC 411 — Final Year Project Report Draft',
      [
        'Student: Toluwanimi Adeyemi (21110311408)',
        'School of Management and Social Sciences, PAU',
        'Topic: Working Capital Efficiency in Nigerian FMCG Firms',
        'Format: 44 pages, Double-sided, Spiral Bound',
      ],
      44
    ),
    createSamplePdf(
      path.join(UPLOADS_DIR, 'doc_sample_3.pdf'),
      'MCM 305 — Integrated Media Campaign Slides',
      [
        'Student: Ibrahim Bello (23140210815)',
        'School of Media and Communication, PAU',
        'Format: 16 pages, Colour Print, 2 Copies',
      ],
      16
    ),
  ]);

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      dbCache = JSON.parse(raw) as PrintHausDatabase;
      return dbCache;
    } catch {
      // Fallback to fresh seed if corrupted
    }
  }

  dbCache = buildInitialDatabase();
  saveDatabase();
  return dbCache;
}

export function getDb(): PrintHausDatabase {
  if (!dbCache) {
    dbCache = buildInitialDatabase();
    saveDatabase();
  }
  return dbCache;
}

export function saveDatabase(): void {
  ensureDirs();
  if (!dbCache) return;
  fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2), 'utf-8');
}

export function getUploadsDir(): string {
  ensureDirs();
  return UPLOADS_DIR;
}

export function generateOrderCodes(existingOrders: PrintOrder[]): {
  orderCode: string;
  collectionCode: string;
} {
  let num = 2051 + existingOrders.length;
  let orderCode = `PH-${num}`;
  while (existingOrders.some((o) => o.orderCode === orderCode)) {
    num += 1;
    orderCode = `PH-${num}`;
  }

  let collectionCode = `PAU-${Math.floor(1000 + Math.random() * 9000)}`;
  while (existingOrders.some((o) => o.collectionCode === collectionCode)) {
    collectionCode = `PAU-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  return { orderCode, collectionCode };
}

export function getStatusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    order_received: 'Order received',
    payment_confirmed: 'Payment confirmed',
    printing_in_progress: 'Printing in progress',
    quality_check: 'Quality check',
    ready_for_collection: 'Ready for Pickup',
    collected: 'Collected',
    rejected: 'Rejected',
  };
  return map[status];
}
