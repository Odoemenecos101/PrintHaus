import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Eye,
  FileText,
  LogOut,
  MessageSquareWarning,
  PackageCheck,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  BindingOption,
  ColorMode,
  ComplaintTicket,
  OrderDocumentItemInput,
  OrderNotification,
  OrderStatus,
  PAU_FEMALE_HOSTELS,
  PAU_MALE_HOSTELS,
  PAU_OFF_CAMPUS_PICKUP_VENUES,
  PaymentMethod,
  PrintOrder,
  PricingConfig,
  SidedMode,
  UserAccount,
  calculateMultiDocumentOrderPricing,
  formatNaira,
} from '../types/printhaus';
import {
  auth,
  fetchOrdersFromFirestore,
  syncOrderToFirestore,
} from '../firebase';
import { OrderHistory } from './OrderHistory';
import { QrCodeBox } from './QrCodeBox';

interface StudentPortalProps {
  user: UserAccount;
  pricing: PricingConfig;
  onBackHome: () => void;
  onLogout: () => void;
  onSwitchRole: () => void;
}

type StudentTab = 'new-order' | 'orders' | 'notifications' | 'support';

interface PickupToast {
  id: string;
  orderId: string;
  orderCode: string;
  collectionCode: string;
  pickupVenue: string;
  pickupShelf: string | null;
  fileName: string;
  timestamp: string;
}

export function StudentPortal({
  user,
  pricing,
  onBackHome,
  onLogout,
  onSwitchRole,
}: StudentPortalProps) {
  const [activeTab, setActiveTab] = useState<StudentTab>('new-order');
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [complaints, setComplaints] = useState<ComplaintTicket[]>([]);

  // Mock Ready-for-Pickup toast notifications
  const [pickupToasts, setPickupToasts] = useState<PickupToast[]>([]);
  const [simulatingPickup, setSimulatingPickup] = useState(false);
  const prevStatusesRef = useRef<Record<string, OrderStatus>>({});
  const hasInitializedStatusesRef = useRef(false);

  // Order placement state
  const [uploadedDoc, setUploadedDoc] = useState<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    pageCount: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [manualPageCount, setManualPageCount] = useState(1);
  const [recipientLabel, setRecipientLabel] = useState('Myself');
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>('bw');
  const [sided, setSided] = useState<SidedMode>('single');
  const [binding, setBinding] = useState<BindingOption>('none');
  const [lamination, setLamination] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [orderQueue, setOrderQueue] = useState<OrderDocumentItemInput[]>([]);
  const pickupSlot = 'Anytime during operating hours';
  const initialCategory: 'off-campus' | 'male' | 'female' =
    user.residency === 'on-campus'
      ? user.hostelGender === 'female'
        ? 'female'
        : 'male'
      : 'off-campus';
  const initialVenue =
    initialCategory === 'off-campus'
      ? PAU_OFF_CAMPUS_PICKUP_VENUES[0]
      : user.hostelName ||
        (initialCategory === 'female' ? PAU_FEMALE_HOSTELS[0] : PAU_MALE_HOSTELS[0]);
  const [pickupCategory, setPickupCategory] = useState<'off-campus' | 'male' | 'female'>(
    initialCategory
  );
  const [pickupVenue, setPickupVenue] = useState<string>(initialVenue);

  const handleSelectPickupCategory = (category: 'off-campus' | 'male' | 'female') => {
    setPickupCategory(category);
    if (category === 'off-campus') {
      if (!(PAU_OFF_CAMPUS_PICKUP_VENUES as readonly string[]).includes(pickupVenue)) {
        setPickupVenue(PAU_OFF_CAMPUS_PICKUP_VENUES[0]);
      }
    } else if (category === 'male') {
      if (!(PAU_MALE_HOSTELS as readonly string[]).includes(pickupVenue)) {
        setPickupVenue(
          user.hostelGender === 'male' && user.hostelName ? user.hostelName : PAU_MALE_HOSTELS[0]
        );
      }
    } else {
      if (!(PAU_FEMALE_HOSTELS as readonly string[]).includes(pickupVenue)) {
        setPickupVenue(
          user.hostelGender === 'female' && user.hostelName
            ? user.hostelName
            : PAU_FEMALE_HOSTELS[0]
        );
      }
    }
  };

  const handleSelectPickupVenue = (venue: string) => {
    setPickupVenue(venue);
    if ((PAU_OFF_CAMPUS_PICKUP_VENUES as readonly string[]).includes(venue)) {
      setPickupCategory('off-campus');
    } else if ((PAU_MALE_HOSTELS as readonly string[]).includes(venue)) {
      setPickupCategory('male');
    } else if ((PAU_FEMALE_HOSTELS as readonly string[]).includes(venue)) {
      setPickupCategory('female');
    }
  };
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('paystack_card');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<PrintOrder | null>(null);

  // Preview, Receipt & Support modals
  const [previewDocId, setPreviewDocId] = useState<{ id: string; name: string; mime: string } | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<PrintOrder | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Support ticket state
  const [supportOrderId, setSupportOrderId] = useState('');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDesc, setSupportDesc] = useState('');
  const [supportSending, setSupportSending] = useState(false);

  const dismissToast = useCallback((toastId: string) => {
    setPickupToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const pushPickupToast = useCallback(
    (order: PrintOrder) => {
      const toastId = `toast_${order.id}_${Date.now()}`;
      const newToast: PickupToast = {
        id: toastId,
        orderId: order.id,
        orderCode: order.orderCode,
        collectionCode: order.collectionCode,
        pickupVenue: order.pickupVenue,
        pickupShelf: order.pickupShelf,
        fileName: order.fileName,
        timestamp: new Date().toISOString(),
      };
      setPickupToasts((prev) => {
        const filtered = prev.filter((t) => t.orderId !== order.id);
        return [newToast, ...filtered].slice(0, 3);
      });
      window.setTimeout(() => {
        dismissToast(toastId);
      }, 9000);
    },
    [dismissToast]
  );

  const loadStudentData = useCallback(async () => {
    try {
      const [ordRes, ntfRes, cmpRes] = await Promise.all([
        fetch(`/api/orders?studentId=${encodeURIComponent(user.id)}`),
        fetch(`/api/notifications?userId=${encodeURIComponent(user.id)}`),
        fetch(`/api/complaints?studentId=${encodeURIComponent(user.id)}`),
      ]);
      const ordData = await ordRes.json();
      const ntfData = await ntfRes.json();
      const cmpData = await cmpRes.json();
      const backendOrders: PrintOrder[] = ordData.orders || [];
      let fetchedOrders: PrintOrder[] = backendOrders;

      if (auth.currentUser && auth.currentUser.uid === user.id) {
        try {
          const cloudOrders = await fetchOrdersFromFirestore(auth.currentUser.uid);
          if (cloudOrders.length > 0) {
            const seen = new Set(backendOrders.map((o) => o.id));
            fetchedOrders = [
              ...backendOrders,
              ...cloudOrders.filter((co) => !seen.has(co.id)),
            ].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          }
        } catch {
          // Keep backend orders if Firestore query is unavailable
        }
      }

      if (hasInitializedStatusesRef.current) {
        for (const ord of fetchedOrders) {
          const prevStatus = prevStatusesRef.current[ord.id];
          if (ord.status === 'ready_for_collection' && prevStatus !== 'ready_for_collection') {
            pushPickupToast(ord);
          }
        }
      }

      const nextStatuses: Record<string, OrderStatus> = {};
      for (const ord of fetchedOrders) {
        nextStatuses[ord.id] = ord.status;
      }
      prevStatusesRef.current = nextStatuses;
      hasInitializedStatusesRef.current = true;

      setOrders(fetchedOrders);
      setNotifications(ntfData.notifications || []);
      setComplaints(cmpData.complaints || []);
      if (fetchedOrders.length > 0) {
        setSelectedOrderId((prev) => prev || fetchedOrders[0].id);
        setSupportOrderId((prev) => prev || fetchedOrders[0].id);
      }
    } catch {
      // Keep polling resilient
    }
  }, [user.id, pushPickupToast]);

  useEffect(() => {
    hasInitializedStatusesRef.current = false;
    prevStatusesRef.current = {};
    loadStudentData();
    const timer = window.setInterval(() => {
      loadStudentData();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [user.id, loadStudentData]);

  const handleSimulateReadyForPickup = async (targetOrder?: PrintOrder) => {
    if (orders.length === 0 || simulatingPickup) return;
    setSimulatingPickup(true);
    try {
      const candidate =
        targetOrder ||
        orders.find((o) => !['ready_for_collection', 'collected', 'rejected'].includes(o.status)) ||
        orders[0];

      if (!['ready_for_collection', 'collected', 'rejected'].includes(candidate.status)) {
        const res = await fetch(`/api/orders/${candidate.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'ready_for_collection',
            actor: 'PAU Print Desk (Simulated)',
            note: `Printed, inspected, and ready for pickup at ${candidate.pickupVenue}.`,
            qualityChecklist: {
              correctDocument: true,
              correctCopies: true,
              correctPageCount: true,
              correctFormat: true,
              printQuality: true,
              packagedAndLabeled: true,
            },
          }),
        });
        if (res.ok) {
          const statusData = await res.json().catch(() => null);
          if (statusData?.order && auth.currentUser && auth.currentUser.uid === user.id) {
            await syncOrderToFirestore(auth.currentUser.uid, statusData.order).catch(() => {});
          }
          await loadStudentData();
          setSelectedOrderId(candidate.id);
          return;
        }
      }

      // Fallback mock alert when order is already Ready/Collected
      const nowIso = new Date().toISOString();
      const shelf = candidate.pickupShelf || 'Cubby A-04';
      const updatedOrder: PrintOrder = {
        ...candidate,
        status: 'ready_for_collection',
        pickupShelf: shelf,
        updatedAt: nowIso,
        statusHistory: [
          ...candidate.statusHistory,
          {
            status: 'ready_for_collection',
            label: 'Ready for Pickup',
            note: `Mock alert: Ready for collection at ${candidate.pickupVenue} (${shelf}).`,
            actor: 'PAU Pickup Desk',
            timestamp: nowIso,
          },
        ],
      };

      setOrders((prev) => prev.map((o) => (o.id === candidate.id ? updatedOrder : o)));
      if (auth.currentUser && auth.currentUser.uid === user.id) {
        syncOrderToFirestore(auth.currentUser.uid, updatedOrder).catch(() => {});
      }
      prevStatusesRef.current[candidate.id] = 'ready_for_collection';
      setNotifications((prev) => [
        {
          id: `ntf_mock_${Date.now()}`,
          userId: user.id,
          orderCode: candidate.orderCode,
          title: `Order ${candidate.orderCode} is Ready for Pickup`,
          message: `Collect anytime during operating hours at ${candidate.pickupVenue} (${shelf}) with code ${candidate.collectionCode}.`,
          read: false,
          createdAt: nowIso,
        },
        ...prev,
      ]);
      setSelectedOrderId(candidate.id);
      pushPickupToast(updatedOrder);
    } finally {
      setSimulatingPickup(false);
    }
  };

  const isFirstOrder = orders.length === 0;
  const stagedItem: OrderDocumentItemInput | null = uploadedDoc
    ? {
        id: `staged_${uploadedDoc.id}`,
        documentId: uploadedDoc.id,
        fileName: uploadedDoc.fileName,
        fileSize: uploadedDoc.size,
        fileType: uploadedDoc.mimeType,
        pageCount: manualPageCount,
        recipientLabel: recipientLabel.trim() || 'Myself',
        specs: { copies, colorMode, sided, binding, lamination, urgent, notes },
      }
    : null;
  const checkoutItems: OrderDocumentItemInput[] = stagedItem
    ? [...orderQueue, stagedItem]
    : orderQueue;

  const { breakdown, computedItems } = calculateMultiDocumentOrderPricing(
    checkoutItems,
    pricing,
    isFirstOrder
  );

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data,
          uploadedBy: user.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Could not upload file.');
        return;
      }
      setUploadedDoc(data.document);
      setManualPageCount(data.document.pageCount || 1);
      setOrderSuccess(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const resetStagedDocument = () => {
    setUploadedDoc(null);
    setManualPageCount(1);
    setCopies(1);
    setColorMode('bw');
    setSided('single');
    setBinding('none');
    setLamination(false);
    setNotes('');
    setRecipientLabel(`Friend #${orderQueue.length + 1}`);
  };

  const handleAddDocumentToQueue = () => {
    if (!stagedItem) return;
    setOrderQueue((prev) => [
      ...prev,
      {
        ...stagedItem,
        id: `doc_item_${Date.now()}_${prev.length + 1}`,
      },
    ]);
    resetStagedDocument();
  };

  const handleRemoveQueuedItem = (id: string) => {
    setOrderQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkoutItems.length === 0) return;
    setSubmittingOrder(true);
    setUploadError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: user.id,
          studentName: user.name,
          studentEmail: user.email,
          matricNumber: user.matricNumber,
          items: checkoutItems,
          paymentMethod,
          pickupVenue,
          pickupSlot,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Order placement failed.');
        return;
      }
      if (auth.currentUser && auth.currentUser.uid === user.id) {
        await syncOrderToFirestore(auth.currentUser.uid, data.order).catch(() => {});
      }
      setOrderSuccess(data.order);
      setSelectedOrderId(data.order.id);
      setOrderQueue([]);
      setUploadedDoc(null);
      setRecipientLabel('Myself');
      setManualPageCount(1);
      setCopies(1);
      setBinding('none');
      setLamination(false);
      setUrgent(false);
      setNotes('');
      await loadStudentData();
    } catch {
      setUploadError('Unable to submit order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportOrderId || !supportSubject || !supportDesc) return;
    setSupportSending(true);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: supportOrderId,
          studentId: user.id,
          subject: supportSubject,
          description: supportDesc,
        }),
      });
      if (res.ok) {
        setSupportSubject('');
        setSupportDesc('');
        await loadStudentData();
      }
    } finally {
      setSupportSending(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

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
            <span className="text-[11px] font-mono text-slate-500">STUDENT</span>
          </div>

          <div className="p-4 border-b border-slate-200 space-y-1">
            <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
            <p className="text-xs font-mono text-slate-500 tabular-nums">
              {user.matricNumber || 'PAU Student'}
            </p>
            {user.department && (
              <p className="text-xs text-slate-700">
                {user.department}
                {user.school ? ` · ${user.school}` : ''}
              </p>
            )}
            <p className="text-[11px] font-mono text-blue-800">
              {user.residency === 'on-campus'
                ? user.hostelName || 'On-Campus Hostel'
                : 'Off-Campus'}
            </p>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('new-order')}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'new-order'
                  ? 'bg-blue-50 text-blue-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>New Print Order</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'orders'
                  ? 'bg-blue-50 text-blue-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 shrink-0" />
                <span>My Orders & Pickup</span>
              </span>
              <span className="font-mono text-xs text-slate-500 tabular-nums">{orders.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('notifications')}
              className={`flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'notifications'
                  ? 'bg-blue-50 text-blue-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Bell className="w-4 h-4 shrink-0" />
                <span>Notifications</span>
              </span>
              {unreadCount > 0 && (
                <span className="font-mono text-xs font-semibold text-blue-800 tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('support')}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'support'
                  ? 'bg-blue-50 text-blue-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <MessageSquareWarning className="w-4 h-4 shrink-0" />
              <span>Support & Reprints</span>
            </button>
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-slate-200 space-y-2">
          <button
            type="button"
            onClick={onSwitchRole}
            className="w-full py-2 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Switch Demo Account
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
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
            <button type="button" onClick={onBackHome} className="hover:text-slate-900 cursor-pointer">
              PrintHaus
            </button>
            <span>/</span>
            <span className="text-slate-900 font-medium">
              {activeTab === 'new-order' && 'New Print Order'}
              {activeTab === 'orders' && 'My Orders & Campus Pickup'}
              {activeTab === 'notifications' && 'Notifications'}
              {activeTab === 'support' && 'Support & Reprints'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onBackHome}
              className="py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              Public Site
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg whitespace-nowrap cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
          {/* TAB 1: NEW PRINT ORDER */}
          {activeTab === 'new-order' && (
            <div className="space-y-6">
              {orderSuccess && (
                <div className="p-6 bg-white border border-emerald-300 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Order {orderSuccess.orderCode} placed successfully</span>
                    </div>
                    <p className="text-sm text-slate-600">
                      {orderSuccess.fileName} ({orderSuccess.pageCount} pages, {orderSuccess.specs.copies}x) ·{' '}
                      {formatNaira(orderSuccess.pricingBreakdown.totalAmount)} · Venue:{' '}
                      <span className="font-semibold text-slate-900">{orderSuccess.pickupVenue}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveTab('orders')}
                        className="py-2 px-4 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 cursor-pointer"
                      >
                        Track Order Progress
                      </button>
                      <button
                        type="button"
                        onClick={() => setReceiptOrder(orderSuccess)}
                        className="py-2 px-4 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
                      >
                        View Receipt
                      </button>
                    </div>
                  </div>
                  <QrCodeBox value={orderSuccess.collectionCode} size={96} />
                </div>
              )}

              <form onSubmit={handlePlaceOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 space-y-6">
                  {/* Document Upload Panel */}
                  <section className="p-6 bg-white border border-slate-200 rounded-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">1. Upload Document</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Supported formats: PDF, Word (.doc, .docx), TXT, or Images (up to 25 MB)
                        </p>
                      </div>
                      {uploadedDoc && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewDocId({
                              id: uploadedDoc.id,
                              name: uploadedDoc.fileName,
                              mime: uploadedDoc.mimeType,
                            })
                          }
                          className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium text-blue-800 bg-blue-50 rounded-lg hover:bg-blue-100 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Preview File</span>
                        </button>
                      )}
                    </div>

                    {uploadError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                        {uploadError}
                      </div>
                    )}

                    <label className="block border border-dashed border-slate-300 hover:border-blue-700 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-50/50">
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                        onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                        className="sr-only"
                      />
                      <Upload className="w-6 h-6 text-blue-800 mx-auto mb-2" />
                      {uploading ? (
                        <p className="text-sm font-medium text-slate-700">Uploading and detecting pages...</p>
                      ) : uploadedDoc ? (
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{uploadedDoc.fileName}</p>
                          <p className="text-xs font-mono text-slate-500 mt-1">
                            {(uploadedDoc.size / 1024).toFixed(1)} KB · Detected {uploadedDoc.pageCount} page(s) · Click to replace
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            Click to choose a PDF or Word document
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Preview your file before paying so you never print the wrong document
                          </p>
                        </div>
                      )}
                    </label>

                    {uploadedDoc && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Who is this for?
                          </label>
                          <input
                            type="text"
                            value={recipientLabel}
                            onChange={(e) => setRecipientLabel(e.target.value)}
                            placeholder="Myself or Friend — Amaka"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Confirmed Page Count
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={manualPageCount}
                            onChange={(e) => setManualPageCount(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Number of Copies
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={copies}
                            onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Printing Preferences */}
                  <section className="p-6 bg-white border border-slate-200 rounded-xl space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-slate-900">
                        2. Select Printing Preferences
                      </h2>
                      {uploadedDoc && (
                        <button
                          type="button"
                          onClick={handleAddDocumentToQueue}
                          className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Document &amp; Upload Another</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Print Colour
                        </label>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                          <button
                            type="button"
                            onClick={() => setColorMode('bw')}
                            className={`py-2 px-3 text-xs font-medium rounded-md cursor-pointer ${
                              colorMode === 'bw' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                            }`}
                          >
                            Black &amp; White
                          </button>
                          <button
                            type="button"
                            onClick={() => setColorMode('color')}
                            className={`py-2 px-3 text-xs font-medium rounded-md cursor-pointer ${
                              colorMode === 'color' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                            }`}
                          >
                            Full Colour
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Sidedness
                        </label>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                          <button
                            type="button"
                            onClick={() => setSided('single')}
                            className={`py-2 px-3 text-xs font-medium rounded-md cursor-pointer ${
                              sided === 'single' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                            }`}
                          >
                            Single-Sided
                          </button>
                          <button
                            type="button"
                            onClick={() => setSided('double')}
                            className={`py-2 px-3 text-xs font-medium rounded-md cursor-pointer ${
                              sided === 'double' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                            }`}
                          >
                            Double-Sided
                          </button>
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Binding / Finishing
                        </label>
                        <select
                          value={binding}
                          onChange={(e) => setBinding(e.target.value as BindingOption)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="none">No binding ({formatNaira(0)})</option>
                          <option value="stapling">Corner stapling ({formatNaira(pricing.stapling)}/copy)</option>
                          <option value="spiral">Spiral coil binding ({formatNaira(pricing.spiralBinding)} entire copy)</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">
                            2b. Pickup Point Selector
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Choose an off-campus venue (TYD, Student&apos;s Centre, Command Centre Gate) or an on-campus Male/Female hostel. Collect anytime during operating hours.
                          </p>
                        </div>

                        {/* Radio selector for Pickup Group */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {[
                            {
                              id: 'off-campus' as const,
                              title: 'Off-Campus Venues',
                              sub: "TYD · Student's Centre · Command Gate",
                            },
                            {
                              id: 'male' as const,
                              title: 'Male Hostels',
                              sub: `${PAU_MALE_HOSTELS.length} on-campus hostels`,
                            },
                            {
                              id: 'female' as const,
                              title: 'Female Hostels',
                              sub: `${PAU_FEMALE_HOSTELS.length} on-campus hostels`,
                            },
                          ].map((group) => (
                            <label
                              key={group.id}
                              className={`flex items-start gap-2.5 p-3 border rounded-lg cursor-pointer transition-colors bg-white ${
                                pickupCategory === group.id
                                  ? 'border-blue-700 bg-blue-50/50'
                                  : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <input
                                type="radio"
                                name="pickupCategory"
                                checked={pickupCategory === group.id}
                                onChange={() => handleSelectPickupCategory(group.id)}
                                className="mt-0.5 accent-blue-800"
                              />
                              <div>
                                <p className="text-xs font-semibold text-slate-900">{group.title}</p>
                                <p className="text-[11px] text-slate-500 mt-0.5">{group.sub}</p>
                              </div>
                            </label>
                          ))}
                        </div>

                        {/* Grouped Pickup Point Dropdown */}
                        <div>
                          <label
                            htmlFor="pickup-point-select"
                            className="block text-xs font-medium text-slate-700 mb-1.5"
                          >
                            Select Exact Pickup Point
                          </label>
                          <select
                            id="pickup-point-select"
                            value={pickupVenue}
                            onChange={(e) => handleSelectPickupVenue(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                          >
                            <optgroup label="Off-Campus Pickup Venues">
                              {PAU_OFF_CAMPUS_PICKUP_VENUES.map((venue) => (
                                <option key={venue} value={venue}>
                                  {venue}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="On-Campus — Male Hostels">
                              {PAU_MALE_HOSTELS.map((hostel) => (
                                <option key={hostel} value={hostel}>
                                  {hostel}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="On-Campus — Female Hostels">
                              {PAU_FEMALE_HOSTELS.map((hostel) => (
                                <option key={hostel} value={hostel}>
                                  {hostel}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex items-center justify-between p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                        <span className="text-xs font-medium text-slate-700">
                          Laminate all pages (+{formatNaira(pricing.laminationPerPage)}/pg)
                        </span>
                        <input
                          type="checkbox"
                          checked={lamination}
                          onChange={(e) => setLamination(e.target.checked)}
                          className="w-4 h-4 accent-blue-800"
                        />
                      </label>
                      <label className="flex items-center justify-between p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                        <span className="text-xs font-medium text-slate-700">
                          Urgent priority run (+{formatNaira(pricing.urgentFee)})
                        </span>
                        <input
                          type="checkbox"
                          checked={urgent}
                          onChange={(e) => setUrgent(e.target.checked)}
                          className="w-4 h-4 accent-blue-800"
                        />
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        Special Instructions (optional)
                      </label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="e.g. Clear acetate front cover, print landscape slides 2-per-page"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </section>

                  {/* Multi-Document Section: Printing for Yourself & Friends */}
                  <section className="p-6 bg-white border border-slate-200 rounded-xl space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          3. Documents in This Order (Yourself &amp; Friends)
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Printing different files for yourself and friends? Add each document above and combine them in one checkout for {pricing.bulkDiscountPct}% off ({pricing.bulkThresholdDocuments}+ documents).
                        </p>
                      </div>
                      {uploadedDoc && (
                        <button
                          type="button"
                          onClick={handleAddDocumentToQueue}
                          className="inline-flex items-center gap-1.5 py-2 px-3.5 text-xs font-medium border border-slate-300 hover:border-slate-900 text-slate-900 rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Save Current Doc &amp; Add Another</span>
                        </button>
                      )}
                    </div>

                    {computedItems.length === 0 ? (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                        No documents added yet. Upload a file above to include it here, or add multiple different files for yourself and friends.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                        {computedItems.map((item) => {
                          const isStaged = item.id.startsWith('staged_');
                          return (
                            <div
                              key={item.id}
                              className="p-3.5 bg-white flex flex-wrap items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-slate-900 truncate">
                                  <span className="font-mono text-blue-800 mr-1.5">
                                    [{item.recipientLabel}]
                                  </span>
                                  {item.fileName}
                                  {isStaged && (
                                    <span className="text-slate-400 font-normal ml-1.5">
                                      (current)
                                    </span>
                                  )}
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

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                  {formatNaira(item.itemSubtotal)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewDocId({
                                      id: item.documentId,
                                      name: item.fileName,
                                      mime: item.fileType,
                                    })
                                  }
                                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
                                  title="Preview document"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    isStaged ? setUploadedDoc(null) : handleRemoveQueuedItem(item.id)
                                  }
                                  className="p-1.5 text-slate-500 hover:text-red-700 rounded cursor-pointer"
                                  title="Remove document"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>

                {/* Right Summary & Payment Panel */}
                <div className="lg:col-span-5 p-6 bg-white border border-slate-200 rounded-xl space-y-5 lg:sticky lg:top-6">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">4. Cost &amp; Payment</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Transparent breakdown for {computedItems.length || 0} file(s) ·{' '}
                      {breakdown.totalDocuments ?? 0} total document copy(s)
                    </p>
                  </div>

                  {(breakdown.totalDocuments ?? 0) > 0 &&
                    (breakdown.totalDocuments ?? 0) < pricing.bulkThresholdDocuments && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700">
                        Add{' '}
                        <span className="font-mono font-semibold text-slate-900">
                          {pricing.bulkThresholdDocuments - (breakdown.totalDocuments ?? 0)}
                        </span>{' '}
                        more document(s) (yours or a friend&apos;s) to unlock{' '}
                        <span className="font-semibold text-blue-800">
                          {pricing.bulkDiscountPct}% bulk discount
                        </span>
                        .
                      </div>
                    )}

                  <div className="space-y-2.5 text-sm border-y border-slate-200 py-4">
                    <div className="flex justify-between text-slate-600">
                      <span>
                        Printing ({breakdown.totalPages} total pages)
                      </span>
                      <span className="font-mono tabular-nums text-slate-900">
                        {formatNaira(breakdown.printCost)}
                      </span>
                    </div>
                    {breakdown.finishingCost > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Binding &amp; Lamination</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {formatNaira(breakdown.finishingCost)}
                        </span>
                      </div>
                    )}
                    {breakdown.urgentFee > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Urgent Turnaround Fee</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {formatNaira(breakdown.urgentFee)}
                        </span>
                      </div>
                    )}
                    {breakdown.discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-700 text-xs">
                        <span>{breakdown.discountReason}</span>
                        <span className="font-mono tabular-nums">
                          -{formatNaira(breakdown.discountAmount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold text-slate-950 text-base">
                      <span>Total Due</span>
                      <span className="font-mono tabular-nums">
                        {formatNaira(breakdown.totalAmount)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-2">
                      Payment Method
                    </label>
                    <div className="space-y-2">
                      {[
                        {
                          id: 'paystack_card' as const,
                          title: 'Paystack Instant Checkout',
                          sub: 'Instant verification · Moves directly to print queue',
                        },
                        {
                          id: 'bank_transfer' as const,
                          title: 'Bank Transfer (Manual Verify)',
                          sub: 'Transfer to PrintHaus PAU Account · Staff verifies reference',
                        },
                        {
                          id: 'campus_wallet' as const,
                          title: 'PAU Campus Wallet',
                          sub: 'Instant student balance deduction',
                        },
                      ].map((m) => (
                        <label
                          key={m.id}
                          className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                            paymentMethod === m.id
                              ? 'border-blue-700 bg-blue-50/50'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            checked={paymentMethod === m.id}
                            onChange={() => setPaymentMethod(m.id)}
                            className="mt-0.5 accent-blue-800"
                          />
                          <div>
                            <p className="text-xs font-semibold text-slate-900">{m.title}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">{m.sub}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-slate-600">Selected Pickup Point</span>
                    <span className="font-semibold text-slate-900 text-right">{pickupVenue}</span>
                  </div>

                  <button
                    type="submit"
                    disabled={checkoutItems.length === 0 || submittingOrder}
                    className="w-full py-3 px-4 bg-blue-800 hover:bg-blue-900 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    {submittingOrder
                      ? 'Submitting Order...'
                      : checkoutItems.length === 0
                        ? 'Upload a Document to Place Order'
                        : `Pay ${formatNaira(breakdown.totalAmount)} & Place Order (${computedItems.length} file${computedItems.length > 1 ? 's' : ''})`}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: ORDER HISTORY & PICKUP */}
          {activeTab === 'orders' && (
            <OrderHistory
              studentId={user.id}
              orders={orders}
              selectedOrderId={selectedOrderId}
              onSelectOrder={setSelectedOrderId}
              onOrdersLoaded={setOrders}
              onCreateFirstOrder={() => setActiveTab('new-order')}
              onPreviewDocument={setPreviewDocId}
              onOpenReceipt={setReceiptOrder}
              onSimulateReadyForPickup={handleSimulateReadyForPickup}
              simulatingPickup={simulatingPickup}
              firstOrderDiscountPct={pricing.firstOrderDiscountPct}
            />
          )}

          {/* TAB 3: NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Order Notifications</h2>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                    {unreadCount} unread alert(s)
                  </p>
                </div>
                {orders.length > 0 && (
                  <button
                    type="button"
                    disabled={simulatingPickup}
                    onClick={() => handleSimulateReadyForPickup()}
                    className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    <Bell className="w-3.5 h-3.5 text-emerald-700" />
                    <span>
                      {simulatingPickup ? 'Triggering...' : 'Simulate "Ready for Pickup" Alert'}
                    </span>
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="p-8 text-sm text-slate-500">No notifications yet.</p>
              ) : (
                <div className="divide-y divide-slate-200">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-5 flex items-start justify-between gap-4 ${
                        !n.read ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-blue-800">
                            {n.orderCode}
                          </span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500 font-mono">
                            {new Date(n.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 mt-1">{n.title}</p>
                        <p className="text-sm text-slate-600 mt-0.5">{n.message}</p>
                      </div>
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => handleMarkRead(n.id)}
                          className="py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SUPPORT & REPRINTS */}
          {activeTab === 'support' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleSubmitComplaint}
                className="lg:col-span-5 p-6 bg-white border border-slate-200 rounded-xl space-y-4"
              >
                <h2 className="text-base font-semibold text-slate-900">
                  Report Print Issue or Request Reprint
                </h2>
                <p className="text-xs text-slate-500">
                  If pages are missing, misaligned, or damaged, submit a ticket for free reprint or
                  refund review.
                </p>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Order</label>
                  <select
                    value={supportOrderId}
                    onChange={(e) => setSupportOrderId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.orderCode} — {o.fileName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
                  <input
                    type="text"
                    required
                    value={supportSubject}
                    onChange={(e) => setSupportSubject(e.target.value)}
                    placeholder="e.g. Missing page 12 or blurred diagram"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Details</label>
                  <textarea
                    rows={4}
                    required
                    value={supportDesc}
                    onChange={(e) => setSupportDesc(e.target.value)}
                    placeholder="Describe the issue and whether you prefer a reprint or refund."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={supportSending || orders.length === 0}
                  className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {supportSending ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </form>

              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-base font-semibold text-slate-900">Your Support Tickets</h3>
                </div>
                {complaints.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500">No support tickets filed.</p>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {complaints.map((c) => (
                      <div key={c.id} className="p-5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-semibold text-slate-700">
                            {c.orderCode}
                          </span>
                          <span className="text-xs font-medium text-slate-700 uppercase font-mono">
                            {c.status}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{c.subject}</p>
                        <p className="text-xs text-slate-600">{c.description}</p>
                        {c.resolutionNote && (
                          <p className="text-xs text-emerald-800 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
                            Resolution: {c.resolutionNote}
                            {c.refundAmount > 0 ? ` (Refunded ${formatNaira(c.refundAmount)})` : ''}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Document Preview Modal */}
      {previewDocId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="truncate">
                <p className="text-sm font-semibold text-slate-900 truncate">{previewDocId.name}</p>
                <p className="text-xs text-slate-500">Document verification preview</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`/api/documents/${previewDocId.id}/file?download=1`}
                  className="py-1.5 px-3 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDocId(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 min-h-[420px] flex items-center justify-center">
              {previewDocId.mime.includes('pdf') || previewDocId.name.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  title={previewDocId.name}
                  src={`/api/documents/${previewDocId.id}/file`}
                  className="w-full h-[65vh] border-0"
                />
              ) : previewDocId.mime.startsWith('image/') ? (
                <img
                  src={`/api/documents/${previewDocId.id}/file`}
                  alt={previewDocId.name}
                  className="max-h-[65vh] object-contain p-4"
                />
              ) : (
                <div className="p-8 text-center max-w-md">
                  <FileText className="w-10 h-10 text-blue-800 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-900">{previewDocId.name}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Word/Office files are queued directly for print rendering. You can download the
                    uploaded file above to verify its contents.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Official Receipt Modal */}
      {receiptOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-base font-bold text-slate-950">
                PrintHaus Official Receipt
              </span>
              <button
                type="button"
                onClick={() => setReceiptOrder(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Order ID</span>
                <span className="font-mono font-bold text-slate-900">{receiptOrder.orderCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Student</span>
                <span className="font-medium text-slate-900">
                  {receiptOrder.studentName} ({receiptOrder.matricNumber})
                </span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-slate-500 shrink-0">Document(s)</span>
                <div className="text-right font-medium text-slate-900 max-w-[230px]">
                  {receiptOrder.items && receiptOrder.items.length > 1 ? (
                    <ul className="space-y-0.5">
                      {receiptOrder.items.map((it) => (
                        <li key={it.id} className="truncate">
                          [{it.recipientLabel}] {it.fileName} ({it.specs.copies}x)
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="truncate block">{receiptOrder.fileName}</span>
                  )}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pickup Venue</span>
                <span className="font-medium text-slate-900">{receiptOrder.pickupVenue}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Ref</span>
                <span className="font-mono text-slate-900">{receiptOrder.paymentReference}</span>
              </div>
              <div className="border-t border-slate-200 pt-3 flex justify-between text-sm font-bold text-slate-950">
                <span>Total Paid</span>
                <span className="font-mono tabular-nums">
                  {formatNaira(receiptOrder.pricingBreakdown.totalAmount)}
                </span>
              </div>
              <div className="pt-2 flex justify-center">
                <QrCodeBox value={receiptOrder.collectionCode} size={96} />
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg cursor-pointer"
              >
                Print / Save Receipt as PDF
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Ready for Pickup UI Toast Stack */}
      {pickupToasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 w-[calc(100vw-2.5rem)] max-w-sm"
        >
          {pickupToasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className="bg-white border border-emerald-300 shadow-lg rounded-xl p-4 flex items-start gap-3"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                <PackageCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-emerald-800">Ready for Pickup</p>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    aria-label="Dismiss notification"
                    className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs font-medium text-slate-900 mt-0.5 truncate">
                  <span className="font-mono font-bold mr-1">{toast.orderCode}</span>
                  {toast.fileName}
                </p>
                <p className="text-[11px] text-slate-600 mt-1">
                  Collect at <span className="font-semibold text-slate-800">{toast.pickupVenue}</span>
                  {toast.pickupShelf ? ` (${toast.pickupShelf})` : ''} · Code{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {toast.collectionCode}
                  </span>
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOrderId(toast.orderId);
                      setActiveTab('orders');
                      dismissToast(toast.id);
                    }}
                    className="text-[11px] font-semibold text-blue-800 hover:text-blue-900 underline cursor-pointer"
                  >
                    View Order &amp; QR Code
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
