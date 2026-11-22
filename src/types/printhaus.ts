export type UserRole = 'student' | 'staff' | 'admin';
export type ResidencyType = 'on-campus' | 'off-campus';
export type HostelGender = 'male' | 'female';

export const PAU_SCHOOLS: Array<{
  school: string;
  programmes: string[];
}> = [
  {
    school: 'School of Management and Social Sciences',
    programmes: ['Accounting', 'Business Administration', 'Economics', 'Finance'],
  },
  {
    school: 'School of Media and Communication',
    programmes: ['Film Studies', 'Information Science', 'Mass Communication', 'Strategic Communication'],
  },
  {
    school: 'School of Science and Technology',
    programmes: ['Computer Science', 'Software Engineering', 'Data Science'],
  },
  {
    school: 'School of Engineering',
    programmes: ['Electrical Engineering', 'Mechanical Engineering', 'Mechatronics Engineering'],
  },
];

export const PAU_MALE_HOSTELS = [
  'Emerald Hostel',
  'EDC Hostel (Enterprise Development Centre)',
  'Amethyst Hostel',
  'Faith Hostel',
  'Cooperative Kings Hostel',
  'Pod Hostel',
] as const;

export const PAU_FEMALE_HOSTELS = [
  'Cooperative Queens Hostel',
  'Redwood Hostel',
  'Pearl Hostel',
  'Trinity Hostel',
  'Trezadel Hostel',
  'Cedar Hostel',
  'Queen-Mary Hostel',
] as const;

export const PAU_OFF_CAMPUS_PICKUP_VENUES = [
  'Security Post in TYD',
  "Student's Centre",
  'Command Centre Gate',
] as const;

export function getSchoolForProgramme(programme?: string): string {
  if (!programme) return '';
  const found = PAU_SCHOOLS.find((s) => s.programmes.includes(programme));
  return found ? found.school : '';
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  matricNumber?: string;
  school?: string;
  department?: string;
  residency?: ResidencyType;
  hostelGender?: HostelGender;
  hostelName?: string;
  role: UserRole;
  roles: UserRole[];
  status: 'active' | 'suspended';
  createdAt: string;
}

const VALID_ROLES: readonly UserRole[] = ['student', 'staff', 'admin'];

export function normalizeRoles(
  roles?: UserRole[] | null,
  fallbackRole?: UserRole | null
): UserRole[] {
  const source: readonly UserRole[] =
    Array.isArray(roles) && roles.length > 0
      ? roles
      : fallbackRole
        ? [fallbackRole]
        : (['student'] as const);
  const unique: UserRole[] = [];
  for (const r of source) {
    if (VALID_ROLES.includes(r) && !unique.includes(r)) {
      unique.push(r);
    }
  }
  return unique.length > 0 ? unique : ['student'];
}

export function getUserRoles(user?: Pick<UserAccount, 'role' | 'roles'> | null): UserRole[] {
  if (!user) return [];
  return normalizeRoles(user.roles, user.role);
}

export function getPrimaryRole(roles: UserRole[]): UserRole {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('staff')) return 'staff';
  return 'student';
}

export function userHasRole(
  user: Pick<UserAccount, 'role' | 'roles'> | null | undefined,
  role: UserRole
): boolean {
  return getUserRoles(user).includes(role);
}

export type OrderStatus =
  | 'order_received'
  | 'payment_confirmed'
  | 'printing_in_progress'
  | 'quality_check'
  | 'ready_for_collection'
  | 'collected'
  | 'rejected';

export type PaymentMethod = 'paystack_card' | 'bank_transfer' | 'campus_wallet';
export type PaymentStatus = 'pending' | 'confirmed' | 'refunded';

export type BindingOption = 'none' | 'stapling' | 'spiral';
export type ColorMode = 'bw' | 'color';
export type SidedMode = 'single' | 'double';

export interface PrintSpecs {
  copies: number;
  colorMode: ColorMode;
  sided: SidedMode;
  binding: BindingOption;
  lamination: boolean;
  urgent: boolean;
  notes: string;
}

export interface OrderDocumentItemInput {
  id?: string;
  documentId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  pageCount: number;
  recipientLabel?: string;
  specs: PrintSpecs;
}

export interface OrderDocumentItem extends OrderDocumentItemInput {
  id: string;
  recipientLabel: string;
  totalPages: number;
  perPageRate: number;
  printCost: number;
  finishingCost: number;
  itemSubtotal: number;
}

export interface PricingConfig {
  bwSinglePerPage: number;
  bwDoublePerPage: number;
  colorSinglePerPage: number;
  colorDoublePerPage: number;
  stapling: number;
  spiralBinding: number;
  laminationPerPage: number;
  urgentFee: number;
  packagingFee: number;
  operatingCostPerOrder: number;
  partnerBwRate: number;
  partnerColorRate: number;
  firstOrderDiscountPct: number;
  bulkThresholdDocuments: number;
  bulkDiscountPct: number;
  updatedAt: string;
}

export interface OrderPricingBreakdown {
  totalDocuments?: number;
  totalPages: number;
  perPageRate: number;
  printCost: number;
  finishingCost: number;
  urgentFee: number;
  discountAmount: number;
  discountReason: string | null;
  totalAmount: number;
  partnerCost: number;
  packagingCost: number;
  operatingCost: number;
  netContribution: number;
}

export interface QualityChecklist {
  correctDocument: boolean;
  correctCopies: boolean;
  correctPageCount: boolean;
  correctFormat: boolean;
  printQuality: boolean;
  packagedAndLabeled: boolean;
}

export interface StatusHistoryEntry {
  status: OrderStatus;
  label: string;
  note: string;
  actor: string;
  timestamp: string;
}

export interface CollectionRecord {
  orderId: string;
  orderCode: string;
  collectionCode: string;
  qrReference: string;
  studentId: string;
  studentName: string;
  matricNumber?: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  collectedAt: string;
  amount: number;
  paymentStatus: PaymentStatus;
  method: 'qr_scan' | 'manual_lookup';
}

export interface CollectionHistoryEntry extends CollectionRecord {
  id: string;
  fileName: string;
  pickupVenue: string;
  status: 'collected';
}

export interface StaffOverviewMetrics {
  totalOrders: number;
  pendingOrders: number;
  processingOrders: number;
  readyForCollection: number;
  collectedOrders: number;
  recentCollections: CollectionHistoryEntry[];
}

export interface PrintOrder {
  id: string;
  orderCode: string;
  collectionCode: string;
  qrReference: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  matricNumber: string;
  documentId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  pageCount: number;
  specs: PrintSpecs;
  items?: OrderDocumentItem[];
  pricingBreakdown: OrderPricingBreakdown;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentReference: string;
  status: OrderStatus;
  statusHistory: StatusHistoryEntry[];
  qualityChecklist: QualityChecklist;
  assignedPartnerId: string;
  assignedPartnerName: string;
  pickupVenue: string;
  pickupSlot: string;
  pickupShelf: string | null;
  rejectionReason: string | null;
  collectionRecord?: CollectionRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrintingPartner {
  id: string;
  name: string;
  type: 'primary' | 'backup';
  location: string;
  contactPhone: string;
  turnaroundMinutes: number;
  costPerBwPage: number;
  costPerColorPage: number;
  status: 'available' | 'busy' | 'offline';
  ordersCompleted: number;
}

export interface SupplyItem {
  id: string;
  name: string;
  category: 'paper' | 'toner' | 'binding' | 'packaging';
  quantity: number;
  unit: string;
  minThreshold: number;
  location: string;
  updatedAt: string;
}

export interface OrderNotification {
  id: string;
  userId: string;
  orderCode: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface ComplaintTicket {
  id: string;
  orderId: string;
  orderCode: string;
  studentId: string;
  studentName: string;
  subject: string;
  description: string;
  status: 'open' | 'resolved' | 'refunded';
  resolutionNote: string | null;
  refundAmount: number;
  createdAt: string;
  updatedAt: string;
}

export const ORDER_STATUS_SEQUENCE: Array<{
  status: OrderStatus;
  label: string;
  description: string;
}> = [
  {
    status: 'order_received',
    label: 'Order received',
    description: 'Order submitted with document attached.',
  },
  {
    status: 'payment_confirmed',
    label: 'Payment confirmed',
    description: 'Payment verified and queued for printing.',
  },
  {
    status: 'printing_in_progress',
    label: 'Printing in progress',
    description: 'Assigned printing partner is producing the order.',
  },
  {
    status: 'quality_check',
    label: 'Quality check',
    description: 'Checked for page count, orientation, and print clarity.',
  },
  {
    status: 'ready_for_collection',
    label: 'Ready for Pickup',
    description: 'Packaged and placed at the PAU central pickup point.',
  },
  {
    status: 'collected',
    label: 'Collected',
    description: 'Student collected order using collection code.',
  },
];

export const PICKUP_OPERATING_HOURS: Array<{ day: string; hours: string }> = [
  { day: 'Monday', hours: '8:00 AM – 5:00 PM' },
  { day: 'Tuesday', hours: '8:00 AM – 5:00 PM' },
  { day: 'Wednesday', hours: '8:00 AM – 5:00 PM' },
  { day: 'Thursday', hours: '8:00 AM – 5:00 PM' },
  { day: 'Friday', hours: '8:00 AM – 5:00 PM' },
  { day: 'Saturday', hours: '9:00 AM – 2:00 PM' },
  { day: 'Sunday', hours: 'Closed' },
];

export const PICKUP_POLICY_RULES: string[] = [
  'Students can collect orders anytime during operating hours.',
  'No fixed pickup windows.',
  'Students receive a notification when their orders are ready.',
  'Collection requires a unique order number or QR code.',
  'Uncollected orders are securely stored until the next working day.',
];

export function formatNaira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}

export function getPerPageRate(specs: Pick<PrintSpecs, 'colorMode' | 'sided'>, pricing: PricingConfig): number {
  if (specs.colorMode === 'bw' && specs.sided === 'double') return pricing.bwDoublePerPage;
  if (specs.colorMode === 'color' && specs.sided === 'single') return pricing.colorSinglePerPage;
  if (specs.colorMode === 'color' && specs.sided === 'double') return pricing.colorDoublePerPage;
  return pricing.bwSinglePerPage;
}

export function computeOrderItemBreakdown(
  item: OrderDocumentItemInput,
  pricing: PricingConfig,
  index: number = 0
): OrderDocumentItem {
  const safePages = Math.max(1, Math.round(item.pageCount));
  const safeCopies = Math.max(1, Math.round(item.specs.copies));
  const totalPages = safePages * safeCopies;
  const perPageRate = getPerPageRate(item.specs, pricing);
  const printCost = totalPages * perPageRate;

  let bindingPerCopy = 0;
  if (item.specs.binding === 'stapling') bindingPerCopy = pricing.stapling;
  if (item.specs.binding === 'spiral') bindingPerCopy = pricing.spiralBinding;

  const bindingCost = bindingPerCopy * safeCopies;
  const laminationCost = item.specs.lamination ? totalPages * pricing.laminationPerPage : 0;
  const finishingCost = bindingCost + laminationCost;

  return {
    ...item,
    id: item.id || `item_${index + 1}`,
    recipientLabel: (item.recipientLabel || '').trim() || 'Self',
    pageCount: safePages,
    specs: { ...item.specs, copies: safeCopies },
    totalPages,
    perPageRate,
    printCost,
    finishingCost,
    itemSubtotal: printCost + finishingCost,
  };
}

export function calculateMultiDocumentOrderPricing(
  items: OrderDocumentItemInput[],
  pricing: PricingConfig,
  isFirstOrder: boolean = false
): { breakdown: OrderPricingBreakdown; computedItems: OrderDocumentItem[] } {
  const computedItems = items.map((item, idx) => computeOrderItemBreakdown(item, pricing, idx));

  const totalDocuments = computedItems.reduce((sum, item) => sum + item.specs.copies, 0);
  const totalPages = computedItems.reduce((sum, item) => sum + item.totalPages, 0);
  const printCost = computedItems.reduce((sum, item) => sum + item.printCost, 0);
  const finishingCost = computedItems.reduce((sum, item) => sum + item.finishingCost, 0);
  const urgentFee = computedItems.some((item) => item.specs.urgent) ? pricing.urgentFee : 0;
  const subtotal = printCost + finishingCost + urgentFee;

  let discountAmount = 0;
  let discountReason: string | null = null;

  if (totalDocuments >= pricing.bulkThresholdDocuments && pricing.bulkDiscountPct > 0) {
    discountAmount = Math.round((printCost * pricing.bulkDiscountPct) / 100);
    discountReason = `Bulk order (${pricing.bulkDiscountPct}% off print pages for ${pricing.bulkThresholdDocuments}+ documents)`;
  } else if (isFirstOrder && pricing.firstOrderDiscountPct > 0 && computedItems.length > 0) {
    discountAmount = Math.round((subtotal * pricing.firstOrderDiscountPct) / 100);
    discountReason = `First-order launch discount (${pricing.firstOrderDiscountPct}%)`;
  }

  const totalAmount = computedItems.length === 0 ? 0 : Math.max(100, subtotal - discountAmount);

  const partnerPrintCost = computedItems.reduce((sum, item) => {
    const partnerRate =
      item.specs.colorMode === 'color' ? pricing.partnerColorRate : pricing.partnerBwRate;
    return sum + item.totalPages * partnerRate;
  }, 0);
  const partnerFinishing = Math.round(finishingCost * 0.65);
  const partnerCost = partnerPrintCost + partnerFinishing;
  const packagingCost = computedItems.length > 0 ? pricing.packagingFee : 0;
  const operatingCost = computedItems.length > 0 ? pricing.operatingCostPerOrder : 0;
  const netContribution = totalAmount - partnerCost - packagingCost - operatingCost;

  const perPageRate =
    totalPages > 0 ? Math.round(printCost / totalPages) : pricing.bwSinglePerPage;

  return {
    computedItems,
    breakdown: {
      totalDocuments,
      totalPages,
      perPageRate,
      printCost,
      finishingCost,
      urgentFee,
      discountAmount,
      discountReason,
      totalAmount,
      partnerCost,
      packagingCost,
      operatingCost,
      netContribution,
    },
  };
}

export function calculateOrderPricing(
  pageCount: number,
  specs: PrintSpecs,
  pricing: PricingConfig,
  isFirstOrder: boolean = false
): OrderPricingBreakdown {
  return calculateMultiDocumentOrderPricing(
    [
      {
        documentId: 'estimate',
        fileName: 'Estimate',
        fileSize: 0,
        fileType: 'application/pdf',
        pageCount,
        specs,
      },
    ],
    pricing,
    isFirstOrder
  ).breakdown;
}
