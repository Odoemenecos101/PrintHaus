import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  Download,
  LogOut,
  PackageCheck,
  Printer,
  QrCode,
  Search,
  Warehouse,
} from 'lucide-react';
import {
  OrderStatus,
  PrintOrder,
  PrintingPartner,
  QualityChecklist,
  SupplyItem,
  UserAccount,
  formatNaira,
} from '../types/printhaus';
import { QrScanner } from './QrScanner';
import { StatusBadge } from './StatusPipeline';

interface StaffPortalProps {
  user: UserAccount;
  onBackHome: () => void;
  onLogout: () => void;
  onSwitchRole: () => void;
}

type StaffTab = 'queue' | 'pickup' | 'supplies';

export function StaffPortal({ user, onBackHome, onLogout, onSwitchRole }: StaffPortalProps) {
  const [activeTab, setActiveTab] = useState<StaffTab>('queue');
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [partners, setPartners] = useState<PrintingPartner[]>([]);
  const [supplies, setSupplies] = useState<SupplyItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shelfInput, setShelfInput] = useState('Cubby A-06');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pickup counter verification
  const [pickupQuery, setPickupQuery] = useState('');
  const [pickupMatch, setPickupMatch] = useState<PrintOrder | null>(null);
  const [pickupMessage, setPickupMessage] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState<string | null>(null);

  const loadData = async () => {
    const [ordRes, ptrRes, supRes] = await Promise.all([
      fetch('/api/orders'),
      fetch('/api/admin/partners'),
      fetch('/api/staff/supplies'),
    ]);
    const ordData = await ordRes.json();
    const ptrData = await ptrRes.json();
    const supData = await supRes.json();
    const list: PrintOrder[] = ordData.orders || [];
    setOrders(list);
    setPartners(ptrData.partners || []);
    setSupplies(supData.supplies || []);
    if (list.length > 0 && !selectedId) {
      setSelectedId(list[0].id);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  const handleConfirmPayment = async (order: PrintOrder) => {
    setBusyId(order.id);
    try {
      await fetch(`/api/orders/${order.id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: user.name }),
      });
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
    try {
      await fetch(`/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, actor: user.name }),
      });
      setShowRejectBox(false);
      setRejectReason('');
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const lookupPickupCode = async (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) return;
    setPickupQuery(clean);
    setPickupError(null);
    setPickupMessage(null);
    const res = await fetch(`/api/orders/track/${encodeURIComponent(clean)}`);
    const data = await res.json();
    if (!res.ok) {
      setPickupMatch(null);
      setPickupError(data.error || 'No order matches that code.');
    } else {
      setPickupMatch(data.order);
    }
  };

  const handleLookupPickup = async (e: React.FormEvent) => {
    e.preventDefault();
    await lookupPickupCode(pickupQuery);
  };

  const handleConfirmCollection = async () => {
    if (!pickupMatch) return;
    setPickupError(null);
    const res = await fetch('/api/orders/verify-collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pickupMatch.collectionCode, actor: user.name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPickupError(data.error || 'Could not confirm collection.');
      return;
    }
    setPickupMatch(data.order);
    setPickupMessage(`Order ${data.order.orderCode} handed over to ${data.order.studentName}.`);
    await loadData();
  };

  const handleAdjustSupply = async (id: string, delta: number) => {
    await fetch(`/api/staff/supplies/${id}`, {
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
            <p className="text-xs text-slate-500 mt-0.5">{user.department || 'Printing Desk'}</p>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                activeTab === 'queue' ? 'bg-blue-50 text-blue-900' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Printer className="w-4 h-4 shrink-0" />
                <span>Print Queue</span>
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
              <span>Pickup Verification</span>
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
          <button
            type="button"
            onClick={onSwitchRole}
            className="w-full py-2 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            Switch Demo Account
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
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>PrintHaus</span>
            <span>/</span>
            <span className="text-slate-900 font-medium">
              {activeTab === 'queue' && 'Printing & Quality Control Queue'}
              {activeTab === 'pickup' && 'Campus Pickup Counter Verification'}
              {activeTab === 'supplies' && 'Paper, Toner & Packaging Supplies'}
            </span>
          </div>
          <button
            type="button"
            onClick={onBackHome}
            className="py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Public Site
          </button>
        </header>

        <main className="p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {/* TAB 1: PRINT QUEUE */}
          {activeTab === 'queue' && (
            <div className="space-y-4">
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

                      <a
                        href={`/api/documents/${selectedOrder.documentId}/file?download=1`}
                        className="inline-flex items-center gap-2 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Document</span>
                      </a>
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
                        <span className="text-slate-500">Binding</span>
                        <p className="font-semibold text-slate-900 mt-1 capitalize">
                          {selectedOrder.items && selectedOrder.items.length > 1
                            ? 'Per document'
                            : selectedOrder.specs.binding}
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
                              <a
                                href={`/api/documents/${item.documentId}/file?download=1`}
                                className="inline-flex items-center gap-1.5 py-1.5 px-3 border border-slate-300 hover:bg-slate-50 text-slate-800 font-medium rounded-lg whitespace-nowrap shrink-0"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download</span>
                              </a>
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

                    {/* Partner Routing & Payment Verification */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Assigned Printing Partner
                        </label>
                        <select
                          value={selectedOrder.assignedPartnerId}
                          onChange={(e) =>
                            handleUpdateOrder(selectedOrder, { assignedPartnerId: e.target.value })
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
                            onClick={() => handleConfirmPayment(selectedOrder)}
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
                                handleUpdateOrder(selectedOrder, {
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
                          disabled={busyId === selectedOrder.id}
                          onClick={() =>
                            handleUpdateOrder(selectedOrder, { status: 'printing_in_progress' })
                          }
                          className="py-2 px-3.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg cursor-pointer"
                        >
                          Start Printing
                        </button>
                        <button
                          type="button"
                          disabled={busyId === selectedOrder.id}
                          onClick={() =>
                            handleUpdateOrder(selectedOrder, { status: 'quality_check' })
                          }
                          className="py-2 px-3.5 text-xs font-medium bg-indigo-700 hover:bg-indigo-800 text-white rounded-lg cursor-pointer"
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
                            disabled={busyId === selectedOrder.id || !allQualityChecked}
                            title={
                              allQualityChecked
                                ? 'Mark ready at PAU Pickup Point'
                                : 'Complete all 6 Quality Control checks first'
                            }
                            onClick={() =>
                              handleUpdateOrder(selectedOrder, {
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
                          onClick={() => setShowRejectBox((v) => !v)}
                          className="py-2 px-3 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                        >
                          Reject Order
                        </button>
                      </div>

                      {!allQualityChecked && selectedOrder.status !== 'collected' && (
                        <p className="text-[11px] text-slate-500">
                          Complete all 6 quality checks above to enable "Mark Ready for Pickup".
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
                              handleUpdateOrder(selectedOrder, {
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

          {/* TAB 2: CAMPUS PICKUP COUNTER VERIFICATION */}
          {activeTab === 'pickup' && (
            <div className="max-w-2xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  PAU Pickup Counter Handover & QR Scanner
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Scan a student&apos;s QR slip with your camera, upload a QR image, or enter their collection code (e.g. <span className="font-mono">PAU-7392</span>) or Order ID (<span className="font-mono">PH-2048</span>).
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <p className="text-xs font-semibold text-slate-900">QR Code Scanner</p>
                <QrScanner onScan={(decoded) => lookupPickupCode(decoded)} />
              </div>

              <form onSubmit={handleLookupPickup} className="flex gap-2">
                <input
                  type="text"
                  required
                  value={pickupQuery}
                  onChange={(e) => setPickupQuery(e.target.value)}
                  placeholder="PAU-7392 or PH-2048"
                  className="flex-1 px-4 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg"
                />
                <button
                  type="submit"
                  className="py-2.5 px-5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg cursor-pointer"
                >
                  Verify Code
                </button>
              </form>

              {pickupError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {pickupError}
                </div>
              )}

              {pickupMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                  {pickupMessage}
                </div>
              )}

              {pickupMatch && (
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm font-bold text-slate-950">
                        {pickupMatch.orderCode} · {pickupMatch.collectionCode}
                      </span>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {pickupMatch.studentName} ({pickupMatch.matricNumber})
                      </p>
                    </div>
                    <StatusBadge status={pickupMatch.status} />
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p>
                      Files:{' '}
                      {pickupMatch.items && pickupMatch.items.length > 1
                        ? pickupMatch.items.map((it) => `${it.recipientLabel}: ${it.fileName}`).join(', ')
                        : pickupMatch.fileName}
                    </p>
                    <p>
                      Pickup Venue:{' '}
                      <span className="font-semibold text-slate-900">{pickupMatch.pickupVenue}</span> ·{' '}
                      Shelf: <span className="font-mono font-semibold">{pickupMatch.pickupShelf || 'Counter Hold'}</span>
                    </p>
                    <p>
                      Quantity: {pickupMatch.pricingBreakdown.totalPages} total pages ·{' '}
                      {pickupMatch.pricingBreakdown.totalDocuments ?? pickupMatch.specs.copies} document copy(s)
                    </p>
                  </div>
                  {pickupMatch.status !== 'collected' && (
                    <button
                      type="button"
                      onClick={handleConfirmCollection}
                      className="inline-flex items-center gap-2 py-2.5 px-5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium rounded-lg cursor-pointer"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>Confirm Student Collection</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SUPPLIES MONITOR */}
          {activeTab === 'supplies' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Print & Packaging Inventory
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
                                onClick={() => handleAdjustSupply(s.id, -1)}
                                className="px-2.5 py-1 text-xs font-mono border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                              >
                                -1
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdjustSupply(s.id, 5)}
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
