import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Clock,
  Download,
  Eye,
  Phone,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { auth, fetchOrdersFromFirestore } from '../firebase';
import { apiFetch } from '../lib/api';
import { PrintOrder, formatNaira, formatTelHref } from '../types/printhaus';
import { QrCodeBox } from './QrCodeBox';
import { StatusBadge, StatusPipeline } from './StatusPipeline';

export type OrderHistoryFilter = 'all' | 'in_progress' | 'ready_for_collection' | 'collected';

interface OrderHistoryProps {
  studentId: string;
  orders: PrintOrder[];
  selectedOrderId: string | null;
  onSelectOrder: (id: string) => void;
  onOrdersLoaded?: (orders: PrintOrder[]) => void;
  onCreateFirstOrder: () => void;
  onPreviewDocument: (doc: { id: string; name: string; mime: string }) => void;
  onOpenReceipt: (order: PrintOrder) => void;
  onSimulateReadyForPickup: (order?: PrintOrder) => void;
  simulatingPickup: boolean;
  firstOrderDiscountPct: number;
}

export function OrderHistory({
  studentId,
  orders: parentOrders,
  selectedOrderId,
  onSelectOrder,
  onOrdersLoaded,
  onCreateFirstOrder,
  onPreviewDocument,
  onOpenReceipt,
  onSimulateReadyForPickup,
  simulatingPickup,
  firstOrderDiscountPct,
}: OrderHistoryProps) {
  const [fetchedOrders, setFetchedOrders] = useState<PrintOrder[]>(parentOrders);
  const [loading, setLoading] = useState(parentOrders.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<OrderHistoryFilter>('all');
  const [historySearch, setHistorySearch] = useState('');

  useEffect(() => {
    setFetchedOrders(parentOrders);
  }, [parentOrders]);

  const fetchOrdersFromBackend = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      else if (parentOrders.length === 0) setLoading(true);
      setFetchError(null);
      try {
        const res = await apiFetch(
          `/api/orders?scope=student&studentId=${encodeURIComponent(studentId)}`
        );
        const data = await res.json();
        if (!res.ok) {
          setFetchError(data.error || 'Could not load order history.');
          return;
        }
        const backendList: PrintOrder[] = data.orders || [];
        let list: PrintOrder[] = backendList;

        if (auth.currentUser && auth.currentUser.uid === studentId) {
          try {
            const cloudList = await fetchOrdersFromFirestore(auth.currentUser.uid);
            if (cloudList.length > 0) {
              const seen = new Set(backendList.map((o) => o.id));
              list = [
                ...backendList,
                ...cloudList.filter((co) => !seen.has(co.id)),
              ].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              );
            }
          } catch {
            // Fallback gracefully to backend list
          }
        }

        setFetchedOrders(list);
        onOrdersLoaded?.(list);
        if (list.length > 0 && !selectedOrderId) {
          onSelectOrder(list[0].id);
        }
      } catch {
        setFetchError('Unable to reach PrintHaus server for order history.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [studentId, parentOrders.length, selectedOrderId, onOrdersLoaded, onSelectOrder]
  );

  useEffect(() => {
    fetchOrdersFromBackend(false);
  }, [studentId]);

  const orders = fetchedOrders;

  const filteredOrders = orders.filter((ord) => {
    const matchesFilter =
      historyFilter === 'all'
        ? true
        : historyFilter === 'in_progress'
          ? [
              'order_received',
              'payment_confirmed',
              'printing_in_progress',
              'quality_check',
            ].includes(ord.status)
          : ord.status === historyFilter;
    const q = historySearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      ord.orderCode.toLowerCase().includes(q) ||
      ord.fileName.toLowerCase().includes(q) ||
      ord.pickupVenue.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  const displayedActiveOrder =
    filteredOrders.find((o) => o.id === selectedOrderId) || filteredOrders[0] || orders[0] || null;

  if (loading) {
    return (
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
        Loading your PrintHaus order history...
      </div>
    );
  }

  if (fetchError && orders.length === 0) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-center justify-between gap-4">
        <span>{fetchError}</span>
        <button
          type="button"
          onClick={() => fetchOrdersFromBackend(true)}
          className="py-1.5 px-3 bg-white border border-red-300 rounded-lg text-xs font-medium text-red-800 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="p-10 bg-white border border-slate-200 rounded-xl text-center">
        <Printer className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-900">No print orders yet</h3>
        <p className="text-sm text-slate-500 mt-1">
          Upload your first assignment or lecture pack to get {firstOrderDiscountPct}% off.
        </p>
        <button
          type="button"
          onClick={onCreateFirstOrder}
          className="mt-4 py-2 px-4 bg-blue-800 text-white text-sm font-medium rounded-lg cursor-pointer"
        >
          Create First Order
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Order History Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'all', label: `All (${orders.length})` },
              {
                id: 'in_progress',
                label: `In Progress (${
                  orders.filter((o) =>
                    [
                      'order_received',
                      'payment_confirmed',
                      'printing_in_progress',
                      'quality_check',
                    ].includes(o.status)
                  ).length
                })`,
              },
              {
                id: 'ready_for_collection',
                label: `Ready for Pickup (${
                  orders.filter((o) => o.status === 'ready_for_collection').length
                })`,
              },
              {
                id: 'collected',
                label: `Collected (${orders.filter((o) => o.status === 'collected').length})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setHistoryFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                historyFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search order ID or file..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => fetchOrdersFromBackend(true)}
            className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            disabled={simulatingPickup}
            onClick={() => onSimulateReadyForPickup()}
            className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-emerald-700" />
            <span>{simulatingPickup ? 'Triggering...' : 'Simulate "Ready for Pickup"'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Past Orders List */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-900">Order History</h2>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'}
            </span>
          </div>
          {filteredOrders.length === 0 ? (
            <p className="p-6 text-xs text-slate-500">No orders match your current filter.</p>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredOrders.map((ord) => (
                <button
                  key={ord.id}
                  type="button"
                  onClick={() => onSelectOrder(ord.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    displayedActiveOrder?.id === ord.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-slate-950">
                      {ord.orderCode}
                    </span>
                    <StatusBadge status={ord.status} />
                  </div>
                  <p className="text-sm font-medium text-slate-900 mt-1.5 truncate">
                    {ord.fileName}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 truncate">
                    {new Date(ord.createdAt).toLocaleString()} · {ord.pickupVenue}
                  </p>
                  {(ord.pickupEta || ord.deliveryStaffPhone) && (
                    <p className="text-[11px] text-blue-900 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 truncate">
                      {ord.pickupEta && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span className="truncate">{ord.pickupEta}</span>
                        </span>
                      )}
                      {ord.deliveryStaffPhone && (
                        <span className="inline-flex items-center gap-1 font-mono shrink-0">
                          <Phone className="w-3 h-3 shrink-0" />
                          <span>{ord.deliveryStaffPhone}</span>
                        </span>
                      )}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
                    <span>
                      {ord.pricingBreakdown.totalPages}p ·{' '}
                      {ord.pricingBreakdown.totalDocuments ?? ord.specs.copies} doc(s)
                    </span>
                    <span className="text-slate-900 font-semibold">
                      {formatNaira(ord.pricingBreakdown.totalAmount)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Order Detail, Activity History & QR Slip */}
        {displayedActiveOrder && (
          <div className="lg:col-span-7 space-y-6">
            <div className="p-6 bg-white border border-slate-200 rounded-xl space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-mono text-lg font-bold text-slate-950">
                      {displayedActiveOrder.orderCode}
                    </h3>
                    <StatusBadge status={displayedActiveOrder.status} />
                  </div>
                  <p className="text-sm text-slate-700 mt-1">{displayedActiveOrder.fileName}</p>
                  <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    Placed {new Date(displayedActiveOrder.createdAt).toLocaleString()} ·{' '}
                    {displayedActiveOrder.pricingBreakdown.totalPages} total pages ·{' '}
                    {formatNaira(displayedActiveOrder.pricingBreakdown.perPageRate)}/pg ·{' '}
                    {formatNaira(
                      Math.round(
                        displayedActiveOrder.pricingBreakdown.totalAmount /
                          Math.max(
                            1,
                            displayedActiveOrder.pricingBreakdown.totalDocuments ??
                              displayedActiveOrder.specs.copies
                          )
                      )
                    )}
                    /copy · Total {formatNaira(displayedActiveOrder.pricingBreakdown.totalAmount)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {!['ready_for_collection', 'collected', 'rejected'].includes(
                    displayedActiveOrder.status
                  ) && (
                    <button
                      type="button"
                      disabled={simulatingPickup}
                      onClick={() => onSimulateReadyForPickup(displayedActiveOrder)}
                      className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span>Mark Ready (Mock)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onPreviewDocument({
                        id: displayedActiveOrder.documentId,
                        name: displayedActiveOrder.fileName,
                        mime: displayedActiveOrder.fileType,
                      })
                    }
                    className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenReceipt(displayedActiveOrder)}
                    className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Receipt</span>
                  </button>
                </div>
              </div>

              <StatusPipeline
                currentStatus={displayedActiveOrder.status}
                history={displayedActiveOrder.statusHistory}
                rejectionReason={displayedActiveOrder.rejectionReason}
              />

              {displayedActiveOrder.items && displayedActiveOrder.items.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">
                      Documents in This Order ({displayedActiveOrder.items.length})
                    </span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {displayedActiveOrder.pricingBreakdown.totalPages} total pages
                    </span>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {displayedActiveOrder.items.map((item) => (
                      <div
                        key={item.id}
                        className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">
                            <span className="font-mono text-blue-800 mr-1.5">
                              [{item.recipientLabel}]
                            </span>
                            {item.fileName}
                          </p>
                          <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                            {item.pageCount}p × {item.specs.copies}x ·{' '}
                            {item.specs.colorMode === 'color' ? 'Colour' : 'B&W'} ·{' '}
                            {item.specs.binding === 'spiral'
                              ? 'Spiral bind'
                              : item.specs.binding === 'stapling'
                                ? 'Stapling'
                                : 'No bind'}
                            {typeof item.perPageRate === 'number'
                              ? ` · ${formatNaira(item.perPageRate)}/pg`
                              : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {typeof item.itemSubtotal === 'number' && (
                            <div className="text-right font-mono tabular-nums">
                              <p className="font-semibold text-slate-900">
                                {formatNaira(item.itemSubtotal)}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {formatNaira(
                                  Math.round(
                                    item.itemSubtotal / Math.max(1, item.specs.copies)
                                  )
                                )}
                                /copy
                              </p>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onPreviewDocument({
                                id: item.documentId,
                                name: item.fileName,
                                mime: item.fileType,
                              })
                            }
                            className="py-1 px-2.5 border border-slate-300 rounded hover:bg-slate-50 text-slate-700 cursor-pointer shrink-0"
                          >
                            Preview
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Order Status History Log */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-600" />
                    <span>Order Activity &amp; Status History</span>
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums">
                    Ref: {displayedActiveOrder.paymentReference}
                  </span>
                </div>
                <div className="divide-y divide-slate-200">
                  {[...displayedActiveOrder.statusHistory]
                    .reverse()
                    .map((entry, idx) => (
                      <div
                        key={`${entry.status}_${entry.timestamp}_${idx}`}
                        className="px-4 py-2.5 flex items-start justify-between gap-4 text-xs"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">
                            {entry.status === 'ready_for_collection'
                              ? 'Ready for Pickup'
                              : entry.label}
                          </p>
                          <p className="text-slate-600 mt-0.5">{entry.note}</p>
                        </div>
                        <div className="text-right text-[11px] font-mono text-slate-500 shrink-0 tabular-nums">
                          <p>{new Date(entry.timestamp).toLocaleString()}</p>
                          <p>{entry.actor}</p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Pickup Arrival Time & Delivering Staff Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-900 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Pickup Arrival Time</span>
                  </p>
                  <p className="text-sm font-semibold text-slate-950">
                    {displayedActiveOrder.pickupEta || displayedActiveOrder.pickupSlot}
                  </p>
                  <p className="text-xs text-slate-600">
                    Venue: <span className="font-medium text-slate-900">{displayedActiveOrder.pickupVenue}</span>
                    {displayedActiveOrder.pickupShelf && ` · Shelf ${displayedActiveOrder.pickupShelf}`}
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-blue-800" />
                    <span>Delivering Staff Contact</span>
                  </p>
                  <p className="text-sm font-semibold text-slate-950">
                    {displayedActiveOrder.deliveryStaffName || 'PrintHaus Dispatch Desk'}
                  </p>
                  {displayedActiveOrder.deliveryStaffPhone ? (
                    <a
                      href={formatTelHref(displayedActiveOrder.deliveryStaffPhone)}
                      className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-blue-800 hover:text-blue-950 underline"
                    >
                      <Phone className="w-3 h-3" />
                      <span>{displayedActiveOrder.deliveryStaffPhone}</span>
                    </a>
                  ) : (
                    <p className="text-xs text-slate-500">Staff contact assigned upon dispatch</p>
                  )}
                </div>
              </div>

              {/* Campus Collection Pass */}
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-5">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-900">
                    PAU Campus Pickup Collection Slip
                  </p>
                  <p className="text-xs text-slate-600">
                    No fixed pickup windows — collect anytime during operating hours (Mon–Fri
                    8:00 AM – 5:00 PM, Sat 9:00 AM – 2:00 PM) with your order number or QR slip.
                    Uncollected orders are stored securely until the next working day.
                  </p>
                  <p className="text-xs font-mono text-slate-700 pt-1">
                    Venue:{' '}
                    <span className="font-semibold text-slate-900">
                      {displayedActiveOrder.pickupVenue}
                    </span>
                    {displayedActiveOrder.pickupShelf &&
                      ` · Shelf: ${displayedActiveOrder.pickupShelf}`}
                  </p>
                  {displayedActiveOrder.status === 'collected' &&
                    displayedActiveOrder.collectionRecord && (
                      <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-900">
                        Collected on{' '}
                        <span className="font-mono font-semibold">
                          {new Date(
                            displayedActiveOrder.collectionRecord.collectedAt
                          ).toLocaleString()}
                        </span>{' '}
                        · Confirmed by{' '}
                        <span className="font-semibold">
                          {displayedActiveOrder.collectionRecord.staffName}
                        </span>
                      </div>
                    )}
                </div>
                <QrCodeBox
                  value={displayedActiveOrder.qrReference || displayedActiveOrder.collectionCode}
                  displayCode={`${displayedActiveOrder.orderCode} · ${displayedActiveOrder.collectionCode}`}
                  size={104}
                  downloadable
                  enlargeable
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
