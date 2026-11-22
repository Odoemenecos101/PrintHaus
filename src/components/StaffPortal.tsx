import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CheckSquare,
  Clock,
  Download,
  History,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Warehouse,
} from 'lucide-react';
import { apiFetch, buildAuthorizedDocumentUrl } from '../lib/api';
import {
  CollectionHistoryEntry,
  OrderStatus,
  PrintOrder,
  PrintingPartner,
  QualityChecklist,
  StaffOverviewMetrics,
  SupplyItem,
  UserAccount,
  UserRole,
  formatNaira,
} from '../types/printhaus';
import { QrScanner } from './QrScanner';
import { StatusBadge } from './StatusPipeline';

interface StaffPortalProps {
  user: UserAccount;
  availableRoles?: UserRole[];
  onSelectDashboard?: (role: UserRole) => void;
  onBackHome: () => void;
  onLogout: () => void;
  onSwitchRole: () => void;
}

type StaffTab = 'overview' | 'queue' | 'pickup' | 'history' | 'supplies';

interface LookupResponse {
  order: PrintOrder;
  canConfirm: boolean;
  alreadyCollected: boolean;
  blockReason: string | null;
}

export function StaffPortal({
  user,
  availableRoles = ['staff'],
  onSelectDashboard,
  onBackHome,
  onLogout,
  onSwitchRole,
}: StaffPortalProps) {
  const [activeTab, setActiveTab] = useState<StaffTab>('overview');
  const [overview, setOverview] = useState<StaffOverviewMetrics | null>(null);
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [partners, setPartners] = useState<PrintingPartner[]>([]);
  const [supplies, setSupplies] = useState<SupplyItem[]>([]);
  const [collections, setCollections] = useState<CollectionHistoryEntry[]>([]);
  const [staffFilterOptions, setStaffFilterOptions] = useState<
    Array<{ staffId: string; staffName: string; staffEmail: string }>
  >([]);

  // Order management state
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shelfInput, setShelfInput] = useState('Cubby A-06');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pickup counter QR + manual verification state
  const [pickupQuery, setPickupQuery] = useState('');
  const [lookupMethod, setLookupMethod] = useState<'qr_scan' | 'manual_lookup'>('manual_lookup');
  const [lookupResult, setLookupResult] = useState<LookupResponse | null>(null);
  const [pickupMessage, setPickupMessage] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [confirmingCollection, setConfirmingCollection] = useState(false);

  // Collection history filters
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [historyStaffId, setHistoryStaffId] = useState('all');

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (historyQuery.trim()) params.set('q', historyQuery.trim());
      if (historyDate) params.set('date', historyDate);
      if (historyStaffId && historyStaffId !== 'all') params.set('staffId', historyStaffId);

      const [ovRes, ordRes, ptrRes, supRes, colRes] = await Promise.all([
        apiFetch('/api/staff/overview'),
        apiFetch('/api/orders'),
        apiFetch('/api/staff/partners'),
        apiFetch('/api/staff/supplies'),
        apiFetch(`/api/staff/collections${params.toString() ? `?${params.toString()}` : ''}`),
      ]);

      const [ovData, ordData, ptrData, supData, colData] = await Promise.all([
        ovRes.json().catch(() => ({})),
        ordRes.json().catch(() => ({})),
        ptrRes.json().catch(() => ({})),
        supRes.json().catch(() => ({})),
        colRes.json().catch(() => ({})),
      ]);

      if (ovData.metrics) setOverview(ovData.metrics);
      const list: PrintOrder[] = ordData.orders || [];
      setOrders(list);
      setPartners(ptrData.partners || []);
      setSupplies(supData.supplies || []);
      setCollections(colData.collections || []);
      if (Array.isArray(colData.staffOptions)) {
        setStaffFilterOptions(colData.staffOptions);
      }
      if (list.length > 0) {
        setSelectedId((prev) => prev || list[0].id);
      }
    } catch {
      // Keep dashboard resilient
    }
  }, [historyQuery, historyDate, historyStaffId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredOrders = orders.filter((o) => {
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    const q = searchTerm.trim().toLowerCase();
    const matchesQuery =
      !q ||
      o.orderCode.toLowerCase().includes(q) ||
      o.collectionCode.toLowerCase().includes(q) ||
      o.studentName.toLowerCase().includes(q) ||
      o.fileName.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  const selectedOrder = orders.find((o) => o.id === selectedId) || filteredOrders[0] || null;

  const handleDownloadDocument = async (documentId: string) => {
    const url = await buildAuthorizedDocumentUrl(documentId, true);
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleConfirmPayment = async (order: PrintOrder) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActionError(err.error || 'Could not confirm payment.');
      }
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateOrder = async (
    order: PrintOrder,
    payload: {
      status?: OrderStatus;
      note?: string;
      qualityChecklist?: Partial<QualityChecklist>;
      pickupShelf?: string;
      assignedPartnerId?: string;
      rejectionReason?: string;
    }
  ) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActionError(err.error || 'Could not update order status.');
      }
      setShowRejectBox(false);
      setRejectReason('');
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const lookupPickupCode = async (rawCode: string, method: 'qr_scan' | 'manual_lookup') => {
    const clean = rawCode.trim();
    if (!clean) return;
    setPickupQuery(clean);
    setLookupMethod(method);
    setPickupError(null);
    setPickupMessage(null);
    setLookingUp(true);
    try {
      const res = await apiFetch('/api/staff/collection/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clean }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLookupResult(null);
        setPickupError(data.error || 'No order matches that code.');
      } else {
        setLookupResult(data as LookupResponse);
      }
    } catch {
      setLookupResult(null);
      setPickupError('Unable to verify order right now.');
    } finally {
      setLookingUp(false);
    }
  };

  const handleLookupPickup = async (e: React.FormEvent) => {
    e.preventDefault();
    await lookupPickupCode(pickupQuery, 'manual_lookup');
  };

  const handleConfirmCollection = async () => {
    if (!lookupResult?.order || confirmingCollection) return;
    setPickupError(null);
    setPickupMessage(null);
    setConfirmingCollection(true);
    try {
      const res = await apiFetch('/api/staff/collection/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: lookupResult.order.id,
          code: lookupResult.order.qrReference || lookupResult.order.orderCode,
          method: lookupMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.order) {
          setLookupResult({
            order: data.order,
            canConfirm: false,
            alreadyCollected: data.order.status === 'collected',
            blockReason: data.error || 'Could not confirm collection.',
          });
        }
        setPickupError(data.error || 'Could not confirm collection.');
        return;
      }
      const updatedOrder = data.order as PrintOrder;
      setLookupResult({
        order: updatedOrder,
        canConfirm: false,
        alreadyCollected: true,
        blockReason: null,
      });
      setPickupMessage(
        `Collection confirmed! Order ${updatedOrder.orderCode} handed over to ${updatedOrder.studentName} by ${user.name}.`
      );
      await loadData();
    } finally {
      setConfirmingCollection(false);
    }
  };

  const handleAdjustSupply = async (id: string, delta: number) => {
    await apiFetch(`/api/staff/supplies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    await loadData();
  };

  const allQualityChecked =
    selectedOrder &&
    Object.values(selectedOrder.qualityChecklist).every(Boolean);

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-900 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between shrink-0">
        <div>
          <div className="px-6 h-16 border-b border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onBackHome}
              className="font-display text-lg font-bold tracking-tight text-slate-950 cursor-pointer"
            >
              PrintHaus
            </button>
            <span className="text-[11px] font-mono text-amber-800 font-semibold">STAFF</span>
          </div>

          <div className="p-4 border-b border-slate-200">
            <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
            <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">{user.email}</p>
            <p className="text-xs text-slate-500 mt-0.5">{user.department || 'Printing Desk'}</p>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                activeTab === 'overview' ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>Overview</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                activeTab === 'queue' ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Printer className="w-4 h-4 shrink-0" />
                <span>Order Management</span>
              </span>
              <span className="font-mono text-xs tabular-nums">{orders.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pickup')}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                activeTab === 'pickup' ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <QrCode className="w-4 h-4 shrink-0" />
              <span>QR Scanner &amp; Pickup</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                activeTab === 'history' ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <History className="w-4 h-4 shrink-0" />
                <span>Collection History</span>
              </span>
              <span className="font-mono text-xs tabular-nums">{collections.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('supplies')}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                activeTab === 'supplies' ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Warehouse className="w-4 h-4 shrink-0" />
              <span>Supplies Monitor</span>
            </button>
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-slate-200 space-y-2">
          {availableRoles.length > 1 && onSelectDashboard && (
            <div className="space-y-1.5 pb-2 border-b border-slate-200">
              <p className="text-[11px] font-medium text-slate-500">Switch Dashboard</p>
              <div className="grid grid-cols-1 gap-1">
                {availableRoles
                  .filter((r) => r !== 'staff')
                  .map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => onSelectDashboard(role)}
                      className="w-full py-2 px-3 text-xs font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer capitalize"
                    >
                      Open {role} Dashboard
                    </button>
                  ))}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onSwitchRole}
            className="w-full py-2 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            Switch Account
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
            <span>PrintHaus</span>
            <span>/</span>
            <span className="text-slate-900 font-medium truncate">
              {activeTab === 'overview' && 'Staff Operations Overview'}
              {activeTab === 'queue' && 'Order Management & Quality Control'}
              {activeTab === 'pickup' && 'QR Code Scanner & Manual Order Lookup'}
              {activeTab === 'history' && 'Campus Collection History'}
              {activeTab === 'supplies' && 'Paper, Toner & Packaging Supplies'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {availableRoles.length > 1 && onSelectDashboard && (
              <div className="flex items-center gap-1.5">
                {availableRoles
                  .filter((r) => r !== 'staff')
                  .map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => onSelectDashboard(role)}
                      className="py-1.5 px-3 text-xs font-semibold text-blue-900 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap cursor-pointer capitalize"
                    >
                      {role} View
                    </button>
                  ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={onBackHome}
              className="py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Public Site
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {/* TAB 0: STAFF OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 border border-slate-200 rounded-xl bg-white divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-5">
                  <p className="text-xs text-slate-500">Total Orders</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-950 mt-1">
                    {overview?.totalOrders ?? orders.length}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">All campus jobs</p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-slate-500">Pending Orders</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
                    {overview?.pendingOrders ??
                      orders.filter((o) =>
                        ['order_received', 'payment_confirmed'].includes(o.status)
                      ).length}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Awaiting print run</p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-slate-500">Processing Orders</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-blue-800 mt-1">
                    {overview?.processingOrders ??
                      orders.filter((o) =>
                        ['printing_in_progress', 'quality_check'].includes(o.status)
                      ).length}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Printing &amp; QC</p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-slate-500">Ready for Collection</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                    {overview?.readyForCollection ??
                      orders.filter((o) => o.status === 'ready_for_collection').length}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">At pickup desk</p>
                </div>
                <div className="p-5 col-span-2 lg:col-span-1">
                  <p className="text-xs text-slate-500">Orders Collected</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-950 mt-1">
                    {overview?.collectedOrders ??
                      orders.filter((o) => o.status === 'collected').length}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Verified handovers</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Recent Collection Activity
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Latest confirmed pickups across campus desks
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('history')}
                      className="text-xs font-medium text-blue-800 hover:text-blue-950 cursor-pointer"
                    >
                      View Full History
                    </button>
                  </div>
                  {(overview?.recentCollections ?? collections).length === 0 ? (
                    <p className="p-6 text-xs text-slate-500">No collections recorded yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {(overview?.recentCollections ?? collections).slice(0, 6).map((c) => (
                        <div
                          key={c.id}
                          className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-950">
                                {c.orderCode}
                              </span>
                              <span className="text-slate-400">·</span>
                              <span className="font-medium text-slate-900">{c.studentName}</span>
                            </div>
                            <p className="text-slate-500 mt-0.5">
                              Confirmed by <span className="text-slate-700 font-medium">{c.staffName}</span> ·{' '}
                              {c.method === 'qr_scan' ? 'QR Scan' : 'Manual Lookup'} · {c.pickupVenue}
                            </p>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <p className="font-semibold text-slate-900">{formatNaira(c.amount)}</p>
                            <p className="text-[11px] text-slate-500">
                              {new Date(c.collectedAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-slate-900">Quick Desk Actions</h2>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Scan a student&apos;s QR code slip at the counter, verify orders ready for pickup, or manage documents in the active print queue.
                  </p>
                  <div className="space-y-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('pickup')}
                      className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>Open QR Scanner &amp; Manual Lookup</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter('ready_for_collection');
                        setActiveTab('queue');
                      }}
                      className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:border-slate-900 text-slate-900 text-xs font-medium rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>View Orders Ready for Collection</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter('all');
                        setActiveTab('queue');
                      }}
                      className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:border-slate-900 text-slate-900 text-xs font-medium rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Inspect Incoming Print Queue</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: ORDER MANAGEMENT / PRINT QUEUE */}
          {activeTab === 'queue' && (
            <div className="space-y-4">
              {actionError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {actionError}
                </div>
              )}

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'order_received', label: 'New' },
                    { id: 'payment_confirmed', label: 'Paid' },
                    { id: 'printing_in_progress', label: 'Printing' },
                    { id: 'quality_check', label: 'QC' },
                    { id: 'ready_for_collection', label: 'Ready' },
                    { id: 'collected', label: 'Collected' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setStatusFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                        statusFilter === f.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full md:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search PH-2048, student, file..."
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Order Queue Table */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="divide-y divide-slate-200">
                    {filteredOrders.length === 0 ? (
                      <p className="p-6 text-sm text-slate-500">No orders match this filter.</p>
                    ) : (
                      filteredOrders.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(o.id);
                            setShowRejectBox(false);
                          }}
                          className={`w-full text-left p-4 transition-colors cursor-pointer ${
                            selectedOrder?.id === o.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-bold text-slate-950">
                              {o.orderCode}
                              {o.specs.urgent ? ' · URGENT' : ''}
                            </span>
                            <StatusBadge status={o.status} />
                          </div>
                          <p className="text-sm font-medium text-slate-900 mt-1 truncate">
                            {o.fileName}
                          </p>
                          <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
                            <span>
                              {o.studentName} ({o.matricNumber})
                            </span>
                            <span className="font-mono tabular-nums text-slate-900 font-semibold">
                              {formatNaira(o.pricingBreakdown.totalAmount)}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Processing Detail Workbench */}
                {selectedOrder && (
                  <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="font-mono text-lg font-bold text-slate-950">
                            {selectedOrder.orderCode}
                          </h2>
                          <StatusBadge status={selectedOrder.status} />
                        </div>
                        <p className="text-sm font-medium text-slate-900 mt-1">
                          {selectedOrder.fileName}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Student: {selectedOrder.studentName} · Matric: {selectedOrder.matricNumber} ·
                          Pickup Venue:{' '}
                          <span className="font-semibold text-slate-900">
                            {selectedOrder.pickupVenue}
                          </span>{' '}
                          · Code:{' '}
                          <span className="font-mono font-semibold text-slate-900">
                            {selectedOrder.collectionCode}
                          </span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDownloadDocument(selectedOrder.documentId)}
                        className="inline-flex items-center gap-2 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Document</span>
                      </button>
                    </div>

                    {/* Print Specs Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-500">Total Pages / Docs</span>
                        <p className="font-mono font-semibold text-slate-900 mt-1 tabular-nums">
                          {selectedOrder.pricingBreakdown.totalPages}p ·{' '}
                          {selectedOrder.items && selectedOrder.items.length > 0
                            ? `${selectedOrder.items.length} file${selectedOrder.items.length > 1 ? 's' : ''}`
                            : `${selectedOrder.specs.copies}x`}
                        </p>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-500">Format</span>
                        <p className="font-semibold text-slate-900 mt-1">
                          {selectedOrder.items && selectedOrder.items.length > 1
                            ? 'Mixed (see docs)'
                            : `${selectedOrder.specs.colorMode === 'color' ? 'Colour' : 'B&W'} · ${selectedOrder.specs.sided}`}
                        </p>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-500">Order Amount</span>
                        <p className="font-mono font-semibold text-slate-900 mt-1 tabular-nums">
                          {formatNaira(selectedOrder.pricingBreakdown.totalAmount)}
                        </p>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-slate-500">Payment</span>
                        <p className="font-mono font-semibold text-slate-900 mt-1 uppercase">
                          {selectedOrder.paymentStatus}
                        </p>
                      </div>
                    </div>

                    {selectedOrder.items && selectedOrder.items.length > 0 && (
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900">
                            Documents in This Order ({selectedOrder.items.length})
                          </span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {selectedOrder.pricingBreakdown.totalDocuments ??
                              selectedOrder.items.reduce((s, it) => s + it.specs.copies, 0)}{' '}
                            total copies
                          </span>
                        </div>
                        <div className="divide-y divide-slate-200">
                          {selectedOrder.items.map((item) => (
                            <div
                              key={item.id}
                              className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-slate-900 truncate">
                                  <span className="font-mono text-blue-800 mr-1.5">
                                    [{item.recipientLabel}]
                                  </span>
                                  {item.fileName}
                                </p>
                                <p className="text-slate-500 mt-0.5 font-mono tabular-nums">
                                  {item.pageCount}p × {item.specs.copies} copy(s) ·{' '}
                                  {item.specs.colorMode === 'color' ? 'Colour' : 'B&W'} ·{' '}
                                  {item.specs.sided} ·{' '}
                                  {item.specs.binding === 'spiral'
                                    ? 'Spiral bind'
                                    : item.specs.binding === 'stapling'
                                      ? 'Stapling'
                                      : 'No bind'}
                                  {item.specs.lamination ? ' · Laminated' : ''}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleDownloadDocument(item.documentId)}
                                className="inline-flex items-center gap-1.5 py-1.5 px-3 border border-slate-300 hover:bg-slate-50 text-slate-800 font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedOrder.specs.notes && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                        Student note: {selectedOrder.specs.notes}
                      </div>
                    )}

                    {selectedOrder.status === 'collected' && selectedOrder.collectionRecord && (
                      <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">
                        Collected on{' '}
                        <span className="font-mono font-semibold">
                          {new Date(selectedOrder.collectionRecord.collectedAt).toLocaleString()}
                        </span>{' '}
                        · Confirmed by{' '}
                        <span className="font-semibold">
                          {selectedOrder.collectionRecord.staffName}
                        </span>{' '}
                        ({selectedOrder.collectionRecord.staffEmail})
                      </div>
                    )}

                    {/* Partner Routing & Payment Verification */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Assigned Printing Partner
                        </label>
                        <select
                          value={selectedOrder.assignedPartnerId}
                          onChange={(e) =>
                            void handleUpdateOrder(selectedOrder, { assignedPartnerId: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                        >
                          {partners.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.status})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-end">
                        {selectedOrder.paymentStatus === 'pending' ? (
                          <button
                            type="button"
                            disabled={busyId === selectedOrder.id}
                            onClick={() => void handleConfirmPayment(selectedOrder)}
                            className="w-full py-2 px-4 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg cursor-pointer"
                          >
                            Confirm Transfer ({selectedOrder.paymentReference})
                          </button>
                        ) : (
                          <div className="w-full py-2 px-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium rounded-lg">
                            Payment verified ({selectedOrder.paymentReference})
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 6-Point Quality Control Checklist */}
                    <div className="p-4 border border-slate-200 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                          <CheckSquare className="w-4 h-4 text-blue-800" />
                          <span>Mandatory 6-Point Quality Control</span>
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {Object.values(selectedOrder.qualityChecklist).filter(Boolean).length}/6 verified
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {(
                          [
                            ['correctDocument', 'Correct document file'],
                            ['correctCopies', 'Correct number of copies'],
                            ['correctPageCount', 'Complete page count'],
                            ['correctFormat', 'Correct B&W / Colour & sidedness'],
                            ['printQuality', 'Readable ink & alignment quality'],
                            ['packagedAndLabeled', 'Packaged in labelled Kraft sleeve'],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedOrder.qualityChecklist[key]}
                              onChange={(e) =>
                                void handleUpdateOrder(selectedOrder, {
                                  qualityChecklist: { [key]: e.target.checked },
                                })
                              }
                              className="w-4 h-4 accent-blue-800"
                            />
                            <span className="text-slate-700">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Workflow Status Actions */}
                    <div className="pt-2 border-t border-slate-200 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === selectedOrder.id || selectedOrder.status === 'collected'}
                          onClick={() =>
                            void handleUpdateOrder(selectedOrder, { status: 'printing_in_progress' })
                          }
                          className="py-2 px-3.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded-lg cursor-pointer"
                        >
                          Start Printing
                        </button>
                        <button
                          type="button"
                          disabled={busyId === selectedOrder.id || selectedOrder.status === 'collected'}
                          onClick={() =>
                            void handleUpdateOrder(selectedOrder, { status: 'quality_check' })
                          }
                          className="py-2 px-3.5 text-xs font-medium bg-indigo-700 hover:bg-indigo-800 disabled:bg-slate-300 text-white rounded-lg cursor-pointer"
                        >
                          Move to Quality Check
                        </button>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={shelfInput}
                            onChange={(e) => setShelfInput(e.target.value)}
                            placeholder="Cubby A-06"
                            className="w-28 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                          />
                          <button
                            type="button"
                            disabled={
                              busyId === selectedOrder.id ||
                              !allQualityChecked ||
                              selectedOrder.status === 'collected'
                            }
                            title={
                              allQualityChecked
                                ? 'Mark ready at PAU Pickup Point'
                                : 'Complete all 6 Quality Control checks first'
                            }
                            onClick={() =>
                              void handleUpdateOrder(selectedOrder, {
                                status: 'ready_for_collection',
                                pickupShelf: shelfInput,
                              })
                            }
                            className="py-2 px-3.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white rounded-lg cursor-pointer disabled:cursor-not-allowed"
                          >
                            Mark Ready for Pickup
                          </button>
                        </div>

                        <button
                          type="button"
                          disabled={selectedOrder.status === 'collected'}
                          onClick={() => setShowRejectBox((v) => !v)}
                          className="py-2 px-3 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-40 rounded-lg cursor-pointer"
                        >
                          Reject Order
                        </button>
                      </div>

                      {!allQualityChecked && selectedOrder.status !== 'collected' && (
                        <p className="text-[11px] text-slate-500">
                          Complete all 6 quality checks above to enable &quot;Mark Ready for Pickup&quot;.
                        </p>
                      )}

                      {showRejectBox && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Reason for rejection (e.g. Corrupted PDF file)"
                            className="flex-1 px-3 py-1.5 text-xs bg-white border border-red-300 rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void handleUpdateOrder(selectedOrder, {
                                status: 'rejected',
                                rejectionReason: rejectReason || 'Corrupted or unreadable document.',
                              })
                            }
                            className="py-1.5 px-3 bg-red-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                          >
                            Confirm Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: CAMPUS PICKUP QR SCANNER & MANUAL ORDER LOOKUP */}
          {activeTab === 'pickup' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    QR Code Scanner &amp; Manual Order Lookup
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Scan the student&apos;s QR code or enter their order number (e.g.{' '}
                    <span className="font-mono">PH-2048</span>) or collection code (
                    <span className="font-mono">PAU-7392</span>). Scanning retrieves order details for verification before you confirm handover.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <p className="text-xs font-semibold text-slate-900">Camera &amp; Image QR Scanner</p>
                  <QrScanner onScan={(decoded) => void lookupPickupCode(decoded, 'qr_scan')} />
                </div>

                <form onSubmit={handleLookupPickup} className="space-y-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Manual Order Lookup
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={pickupQuery}
                      onChange={(e) => setPickupQuery(e.target.value)}
                      placeholder="Order # (PH-2048), PAU-7392, or QR ref"
                      className="flex-1 px-4 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg"
                    />
                    <button
                      type="submit"
                      disabled={lookingUp}
                      className="py-2.5 px-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      {lookingUp ? 'Checking...' : 'Lookup Order'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h3 className="text-base font-semibold text-slate-950">
                  Order Verification &amp; Handover Confirmation
                </h3>

                {pickupError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                    {pickupError}
                  </div>
                )}

                {pickupMessage && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <span>{pickupMessage}</span>
                  </div>
                )}

                {lookupResult ? (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                    <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
                      <div>
                        <span className="font-mono text-base font-bold text-slate-950">
                          {lookupResult.order.orderCode} · {lookupResult.order.collectionCode}
                        </span>
                        <p className="text-sm font-semibold text-slate-900 mt-1">
                          {lookupResult.order.studentName} ({lookupResult.order.matricNumber})
                        </p>
                      </div>
                      <StatusBadge status={lookupResult.order.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-white border border-slate-200 rounded-lg">
                        <span className="text-slate-500">Copies &amp; Pages</span>
                        <p className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                          {lookupResult.order.pricingBreakdown.totalDocuments ??
                            lookupResult.order.specs.copies}{' '}
                          copy(s) · {lookupResult.order.pricingBreakdown.totalPages} pages
                        </p>
                      </div>
                      <div className="p-3 bg-white border border-slate-200 rounded-lg">
                        <span className="text-slate-500">Amount &amp; Payment</span>
                        <p className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums uppercase">
                          {formatNaira(lookupResult.order.pricingBreakdown.totalAmount)} ·{' '}
                          {lookupResult.order.paymentStatus}
                        </p>
                      </div>
                    </div>

                    <div className="text-xs text-slate-700 space-y-1.5">
                      <p>
                        <span className="font-semibold text-slate-900">Document(s):</span>{' '}
                        {lookupResult.order.items && lookupResult.order.items.length > 1
                          ? lookupResult.order.items
                              .map((it) => `${it.recipientLabel}: ${it.fileName} (${it.specs.copies}x)`)
                              .join(', ')
                          : lookupResult.order.fileName}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-900">Pickup Venue:</span>{' '}
                        {lookupResult.order.pickupVenue} · Shelf:{' '}
                        <span className="font-mono font-semibold">
                          {lookupResult.order.pickupShelf || 'Counter Hold'}
                        </span>
                      </p>
                    </div>

                    {lookupResult.alreadyCollected && lookupResult.order.collectionRecord && (
                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-1">
                        <p className="font-semibold">Already Collected</p>
                        <p>
                          Confirmed on{' '}
                          <span className="font-mono">
                            {new Date(lookupResult.order.collectionRecord.collectedAt).toLocaleString()}
                          </span>{' '}
                          by{' '}
                          <span className="font-semibold">
                            {lookupResult.order.collectionRecord.staffName}
                          </span>{' '}
                          ({lookupResult.order.collectionRecord.staffEmail}).
                        </p>
                      </div>
                    )}

                    {!lookupResult.alreadyCollected && lookupResult.blockReason && (
                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950">
                        {lookupResult.blockReason}
                      </div>
                    )}

                    {lookupResult.canConfirm && (
                      <button
                        type="button"
                        disabled={confirmingCollection}
                        onClick={() => void handleConfirmCollection()}
                        className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg cursor-pointer"
                      >
                        <PackageCheck className="w-4 h-4" />
                        <span>
                          {confirmingCollection ? 'Confirming Handover...' : 'Confirm Collection'}
                        </span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-8 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-500">
                    Scan a QR slip or enter an order number on the left to inspect order details and confirm collection.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: COLLECTION HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    placeholder="Search by order # or student name..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(e) => setHistoryDate(e.target.value)}
                    aria-label="Filter by collection date"
                    className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-mono"
                  />
                  <select
                    value={historyStaffId}
                    onChange={(e) => setHistoryStaffId(e.target.value)}
                    aria-label="Filter by staff member"
                    className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="all">All Staff Members</option>
                    {staffFilterOptions.map((s) => (
                      <option key={s.staffId} value={s.staffId}>
                        {s.staffName}
                      </option>
                    ))}
                  </select>
                  {(historyQuery || historyDate || historyStaffId !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryQuery('');
                        setHistoryDate('');
                        setHistoryStaffId('all');
                      }}
                      className="py-2 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Confirmed Collection History
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Persistent audit log of every order collected at PrintHaus desks
                    </p>
                  </div>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {collections.length} record{collections.length === 1 ? '' : 's'}
                  </span>
                </div>

                {collections.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    <Clock className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                    No collections match your current filters.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <tr>
                          <th className="py-3 px-4">Order</th>
                          <th className="py-3 px-4">Student</th>
                          <th className="py-3 px-4">Confirmed By Staff</th>
                          <th className="py-3 px-4">Date &amp; Time</th>
                          <th className="py-3 px-4">Method</th>
                          <th className="py-3 px-4 text-right">Amount</th>
                          <th className="py-3 px-4">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {collections.map((entry) => {
                          const dt = new Date(entry.collectedAt);
                          return (
                            <tr key={entry.id} className="h-12 hover:bg-slate-50">
                              <td className="px-4 font-mono font-semibold text-slate-950">
                                {entry.orderCode}
                                <span className="block text-[11px] font-normal text-slate-500">
                                  {entry.collectionCode}
                                </span>
                              </td>
                              <td className="px-4">
                                <p className="font-medium text-slate-900">{entry.studentName}</p>
                                <p className="text-[11px] text-slate-500 truncate max-w-[180px]">
                                  {entry.fileName}
                                </p>
                              </td>
                              <td className="px-4">
                                <p className="font-medium text-slate-900">{entry.staffName}</p>
                                <p className="font-mono text-[11px] text-slate-500">
                                  {entry.staffEmail}
                                </p>
                              </td>
                              <td className="px-4 font-mono tabular-nums text-slate-700">
                                <p>{dt.toLocaleDateString()}</p>
                                <p className="text-[11px] text-slate-500">{dt.toLocaleTimeString()}</p>
                              </td>
                              <td className="px-4 font-mono text-[11px] text-slate-700">
                                {entry.method === 'qr_scan' ? 'QR Scan' : 'Manual Lookup'}
                              </td>
                              <td className="px-4 text-right font-mono tabular-nums font-semibold text-slate-950">
                                {formatNaira(entry.amount)}
                              </td>
                              <td className="px-4">
                                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  Collected
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SUPPLIES MONITOR */}
          {activeTab === 'supplies' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Print &amp; Packaging Inventory
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Maintain minimum supply levels so printing never stalls during exam weeks
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="py-3 px-5">Supply Item</th>
                      <th className="py-3 px-5">Location</th>
                      <th className="py-3 px-5 text-right">Current Stock</th>
                      <th className="py-3 px-5 text-right">Min Threshold</th>
                      <th className="py-3 px-5">Status</th>
                      <th className="py-3 px-5 text-right">Adjust</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {supplies.map((s) => {
                      const low = s.quantity <= s.minThreshold;
                      return (
                        <tr key={s.id} className="h-12">
                          <td className="px-5 font-medium text-slate-900">{s.name}</td>
                          <td className="px-5 text-xs text-slate-600">{s.location}</td>
                          <td className="px-5 text-right font-mono tabular-nums font-semibold">
                            {s.quantity} {s.unit}
                          </td>
                          <td className="px-5 text-right font-mono tabular-nums text-slate-500">
                            {s.minThreshold} {s.unit}
                          </td>
                          <td className="px-5">
                            <span
                              className={`text-xs font-medium ${
                                low ? 'text-amber-800' : 'text-emerald-700'
                              }`}
                            >
                              {low ? 'Reorder Soon' : 'Stocked'}
                            </span>
                          </td>
                          <td className="px-5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleAdjustSupply(s.id, -1)}
                                className="px-2.5 py-1 text-xs font-mono border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                              >
                                -1
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleAdjustSupply(s.id, 5)}
                                className="px-2.5 py-1 text-xs font-mono bg-slate-900 text-white rounded hover:bg-slate-800 cursor-pointer"
                              >
                                +5
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
