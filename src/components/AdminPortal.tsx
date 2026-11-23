import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  Eye,
  EyeOff,
  LogOut,
  MessageSquareWarning,
  Phone,
  Search,
  Sliders,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  CollectionHistoryEntry,
  ComplaintTicket,
  PrintOrder,
  PricingConfig,
  PrintingPartner,
  UserAccount,
  UserRole,
  formatNaira,
  getUserRoles,
} from '../types/printhaus';
import { StatusBadge } from './StatusPipeline';

interface AdminPortalProps {
  user: UserAccount;
  availableRoles?: UserRole[];
  onSelectDashboard?: (role: UserRole) => void;
  pricing: PricingConfig;
  onPricingUpdated: (next: PricingConfig) => void;
  onBackHome: () => void;
  onLogout: () => void;
  onSwitchRole: () => void;
}

type AdminTab = 'overview' | 'pricing' | 'partners' | 'accounts' | 'complaints';

interface AdminMetrics {
  totalOrders: number;
  activeQueueCount: number;
  readyForPickupCount: number;
  grossRevenue: number;
  partnerPayouts: number;
  packagingAndOperating: number;
  netContribution: number;
  totalPagesPrinted: number;
  uniqueStudents: number;
  repeatCustomers: number;
  openComplaints: number;
}

interface StaffRosterMember extends UserAccount {
  collectionStats: {
    totalCollections: number;
    lastCollectedAt: string | null;
    recentCollections: CollectionHistoryEntry[];
  };
}

export function AdminPortal({
  user,
  availableRoles = ['admin'],
  onSelectDashboard,
  pricing,
  onPricingUpdated,
  onBackHome,
  onLogout,
  onSwitchRole,
}: AdminPortalProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [partners, setPartners] = useState<PrintingPartner[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [staffRoster, setStaffRoster] = useState<StaffRosterMember[]>([]);
  const [recentCollections, setRecentCollections] = useState<CollectionHistoryEntry[]>([]);
  const [complaints, setComplaints] = useState<ComplaintTicket[]>([]);
  const [draftPricing, setDraftPricing] = useState<PricingConfig>(pricing);
  const [pricingSaved, setPricingSaved] = useState(false);

  // Staff & Multi-role management state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newDept, setNewDept] = useState('Campus Pickup Desk');
  const [newRoles, setNewRoles] = useState<UserRole[]>(['staff']);
  const [staffSearch, setStaffSearch] = useState('');
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [editingPhoneValue, setEditingPhoneValue] = useState('');
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);

  // Refund / resolution state
  const [resolutionMap, setResolutionMap] = useState<Record<string, string>>({});
  const [refundMap, setRefundMap] = useState<Record<string, number>>({});

  const loadAdminData = useCallback(async () => {
    const [ovRes, ordRes, ptrRes, usrRes, stfRes, cmpRes] = await Promise.all([
      apiFetch('/api/admin/overview'),
      apiFetch('/api/orders'),
      apiFetch('/api/admin/partners'),
      apiFetch('/api/admin/users'),
      apiFetch(`/api/admin/staff${staffSearch.trim() ? `?q=${encodeURIComponent(staffSearch.trim())}` : ''}`),
      apiFetch('/api/complaints'),
    ]);
    const [ovData, ordData, ptrData, usrData, stfData, cmpData] = await Promise.all([
      ovRes.json().catch(() => ({})),
      ordRes.json().catch(() => ({})),
      ptrRes.json().catch(() => ({})),
      usrRes.json().catch(() => ({})),
      stfRes.json().catch(() => ({})),
      cmpRes.json().catch(() => ({})),
    ]);
    if (ovData.metrics) setMetrics(ovData.metrics);
    setOrders(ordData.orders || []);
    setPartners(ptrData.partners || []);
    setUsers(usrData.users || []);
    setStaffRoster(stfData.staff || []);
    setRecentCollections(stfData.recentCollections || []);
    setComplaints(cmpData.complaints || []);
  }, [staffSearch]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  useEffect(() => {
    setDraftPricing(pricing);
  }, [pricing]);

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch('/api/pricing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draftPricing),
    });
    const data = await res.json();
    if (res.ok && data.pricing) {
      onPricingUpdated(data.pricing);
      setPricingSaved(true);
      setTimeout(() => setPricingSaved(false), 3000);
    }
  };

  const handlePartnerStatus = async (id: string, status: PrintingPartner['status']) => {
    await apiFetch(`/api/admin/partners/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadAdminData();
  };

  const toggleNewRole = (role: UserRole) => {
    setNewRoles((prev) => {
      if (prev.includes(role)) {
        return prev.length > 1 ? prev.filter((r) => r !== role) : prev;
      }
      return [...prev, role];
    });
  };

  const handleAddOrGrantStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAccountError(null);
    setAccountNotice(null);
    setSavingAccount(true);
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          phone: newPhone.trim() || undefined,
          password: newPassword.trim() || undefined,
          department: newDept.trim(),
          roles: newRoles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAccountError(data.error || 'Could not save staff account.');
        return;
      }
      setAccountNotice(
        data.mergedExisting
          ? `Updated existing account (${data.user.email}) with roles: ${getUserRoles(data.user).join(', ')}. No duplicate created.`
          : `Created account for ${data.user.name} (${data.user.email}) with roles: ${getUserRoles(data.user).join(', ')}.`
      );
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewPassword('');
      setNewRoles(['staff']);
      await loadAdminData();
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSaveStaffPhone = async (target: UserAccount) => {
    setAccountError(null);
    setAccountNotice(null);
    const res = await apiFetch(`/api/admin/users/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: editingPhoneValue.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAccountError(data.error || 'Could not update phone number.');
      return;
    }
    setEditingPhoneId(null);
    setAccountNotice(
      data.user.phone
        ? `Updated phone number for ${target.name} to ${data.user.phone}.`
        : `Cleared phone number for ${target.name}.`
    );
    await loadAdminData();
  };

  const handleToggleUserRole = async (target: UserAccount, roleToToggle: UserRole) => {
    setAccountError(null);
    setAccountNotice(null);
    const current = getUserRoles(target);
    let next: UserRole[];
    if (current.includes(roleToToggle)) {
      if (current.length === 1) {
        setAccountError('Every account must keep at least one role. Use Suspend to deactivate instead.');
        return;
      }
      next = current.filter((r) => r !== roleToToggle);
    } else {
      next = [...current, roleToToggle];
    }

    const res = await apiFetch(`/api/admin/users/${target.id}/roles`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAccountError(data.error || 'Could not update roles.');
      return;
    }
    setAccountNotice(
      `Updated roles for ${target.name} (${target.email}): ${getUserRoles(data.user).join(', ')}.`
    );
    await loadAdminData();
  };

  const handleToggleUserStatus = async (u: UserAccount) => {
    setAccountError(null);
    setAccountNotice(null);
    const nextStatus = u.status === 'active' ? 'suspended' : 'active';
    const res = await apiFetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAccountError(data.error || 'Could not update account status.');
      return;
    }
    setAccountNotice(
      `${u.name} (${u.email}) is now ${nextStatus === 'active' ? 'active' : 'deactivated'}.`
    );
    await loadAdminData();
  };

  const handleResolveComplaint = async (c: ComplaintTicket, status: 'resolved' | 'refunded') => {
    await apiFetch(`/api/complaints/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        resolutionNote:
          resolutionMap[c.id] ||
          (status === 'refunded' ? 'Approved refund for printing error.' : 'Resolved by Admin.'),
        refundAmount: status === 'refunded' ? Number(refundMap[c.id] ?? 300) : 0,
      }),
    });
    await loadAdminData();
  };

  const filteredDirectoryUsers = users.filter((u) => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.department || '').toLowerCase().includes(q)
    );
  });

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
            <span className="text-[11px] font-mono text-blue-900 font-semibold">ADMIN</span>
          </div>

          <div className="p-4 border-b border-slate-200">
            <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
            <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">{user.email}</p>
            <p className="text-xs text-slate-500 mt-0.5">{user.department || 'Operations Lead'}</p>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {[
              { id: 'overview' as const, label: 'Revenue & Orders', icon: BarChart3 },
              { id: 'pricing' as const, label: 'Pricing Rules', icon: Sliders },
              { id: 'partners' as const, label: 'Printing Partners', icon: Building2 },
              { id: 'accounts' as const, label: 'Staff & Multi-Role', icon: Users },
              { id: 'complaints' as const, label: 'Complaints & Refunds', icon: MessageSquareWarning },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap cursor-pointer ${
                    activeTab === item.id
                      ? 'bg-blue-50 text-blue-900'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-slate-200 space-y-2">
          {availableRoles.length > 1 && onSelectDashboard && (
            <div className="space-y-1.5 pb-2 border-b border-slate-200">
              <p className="text-[11px] font-medium text-slate-500">Switch Dashboard</p>
              <div className="grid grid-cols-1 gap-1">
                {availableRoles
                  .filter((r) => r !== 'admin')
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
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>PrintHaus</span>
            <span>/</span>
            <span className="text-slate-900 font-medium capitalize">
              {activeTab === 'accounts' ? 'Staff & Multi-Role Management' : activeTab}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {availableRoles.length > 1 && onSelectDashboard && (
              <div className="flex items-center gap-1.5">
                {availableRoles
                  .filter((r) => r !== 'admin')
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
          {/* OVERVIEW & REVENUE LEDGER */}
          {activeTab === 'overview' && metrics && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-xl bg-white divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-5">
                  <p className="text-xs text-slate-500">Gross Customer Sales</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-950 mt-1">
                    {formatNaira(metrics.grossRevenue)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {metrics.totalOrders} orders · {metrics.totalPagesPrinted} pages
                  </p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-slate-500">Partner &amp; Operating Costs</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-950 mt-1">
                    {formatNaira(metrics.partnerPayouts + metrics.packagingAndOperating)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    Press: {formatNaira(metrics.partnerPayouts)} · Ops: {formatNaira(metrics.packagingAndOperating)}
                  </p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-slate-500">Net Contribution</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                    {formatNaira(metrics.netContribution)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    After partner, envelope &amp; ops allocation
                  </p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-slate-500">Repeat PAU Customers</p>
                  <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-950 mt-1">
                    {metrics.repeatCustomers} / {metrics.uniqueStudents}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {metrics.activeQueueCount} active in queue · {metrics.openComplaints} open tickets
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    All Campus Orders &amp; Unit Economics
                  </h2>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {orders.length} records
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-3 px-4">Order</th>
                        <th className="py-3 px-4">Student</th>
                        <th className="py-3 px-4">Document</th>
                        <th className="py-3 px-4 text-right">Pages</th>
                        <th className="py-3 px-4 text-right">Paid</th>
                        <th className="py-3 px-4 text-right">Partner</th>
                        <th className="py-3 px-4 text-right">Margin</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {orders.map((o) => (
                        <tr key={o.id} className="h-11 hover:bg-slate-50">
                          <td className="px-4 font-mono font-semibold text-slate-900">
                            {o.orderCode}
                          </td>
                          <td className="px-4 text-slate-700">{o.studentName}</td>
                          <td className="px-4 text-slate-700 max-w-[200px] truncate">{o.fileName}</td>
                          <td className="px-4 text-right font-mono tabular-nums">
                            {o.pricingBreakdown.totalPages}
                          </td>
                          <td className="px-4 text-right font-mono tabular-nums font-semibold">
                            {formatNaira(o.pricingBreakdown.totalAmount)}
                          </td>
                          <td className="px-4 text-right font-mono tabular-nums text-slate-600">
                            {formatNaira(o.pricingBreakdown.partnerCost)}
                          </td>
                          <td className="px-4 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                            {formatNaira(o.pricingBreakdown.netContribution)}
                          </td>
                          <td className="px-4">
                            <StatusBadge status={o.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PRICING ENGINE */}
          {activeTab === 'pricing' && (
            <form
              onSubmit={handleSavePricing}
              className="max-w-3xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Platform Printing Prices &amp; Discounts (₦)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Changes update the public calculator and student checkout immediately
                  </p>
                </div>
                {pricingSaved && (
                  <span className="text-xs font-medium text-emerald-700">Saved live</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {(
                  [
                    ['bwSinglePerPage', 'B&W Single-Sided (₦/page)'],
                    ['bwDoublePerPage', 'B&W Double-Sided (₦/page)'],
                    ['colorSinglePerPage', 'Colour Single-Sided (₦/page)'],
                    ['colorDoublePerPage', 'Colour Double-Sided (₦/page)'],
                    ['stapling', 'Corner Stapling (₦/copy)'],
                    ['spiralBinding', 'Spiral Binding (₦/entire copy)'],
                    ['laminationPerPage', 'Lamination (₦/page)'],
                    ['urgentFee', 'Urgent Turnaround Fee (₦)'],
                    ['packagingFee', 'Packaging Allocation (₦/order)'],
                    ['firstOrderDiscountPct', 'First-Order Discount (%)'],
                    ['bulkThresholdDocuments', 'Bulk Discount Min. Documents'],
                    ['bulkDiscountPct', 'Bulk Order Discount (%)'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      value={draftPricing[key]}
                      onChange={(e) =>
                        setDraftPricing((prev) => ({
                          ...prev,
                          [key]: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                    />
                  </div>
                ))}
              </div>

              <button
                type="submit"
                className="py-2.5 px-5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg cursor-pointer"
              >
                Save Pricing Rules
              </button>
            </form>
          )}

          {/* PRINTING PARTNERS */}
          {activeTab === 'partners' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {partners.map((p) => (
                <div key={p.id} className="p-6 bg-white border border-slate-200 rounded-xl space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-[11px] uppercase text-blue-800 font-semibold">
                        {p.type} partner
                      </span>
                      <h3 className="text-base font-semibold text-slate-900 mt-1">{p.name}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{p.location}</p>
                    </div>
                    <select
                      value={p.status}
                      onChange={(e) =>
                        void handlePartnerStatus(p.id, e.target.value as PrintingPartner['status'])
                      }
                      className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="available">Available</option>
                      <option value="busy">Busy</option>
                      <option value="offline">Offline</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-200 font-mono tabular-nums">
                    <div>
                      <span className="text-slate-500 font-sans">Turnaround</span>
                      <p className="font-semibold text-slate-900 mt-0.5">{p.turnaroundMinutes} mins</p>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans">B&amp;W Cost</span>
                      <p className="font-semibold text-slate-900 mt-0.5">{formatNaira(p.costPerBwPage)}/pg</p>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans">Completed</span>
                      <p className="font-semibold text-slate-900 mt-0.5">{p.ordersCompleted} orders</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ACCOUNTS, STAFF & MULTI-ROLE MANAGEMENT */}
          {activeTab === 'accounts' && (
            <div className="space-y-6">
              {accountError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {accountError}
                </div>
              )}
              {accountNotice && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">
                  {accountNotice}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Create or Upgrade Staff Account */}
                <form
                  onSubmit={handleAddOrGrantStaff}
                  className="lg:col-span-4 p-6 bg-white border border-slate-200 rounded-xl space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-blue-800" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Create or Grant Staff Access
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Add a staff member using Gmail or any authorized email, or enter an existing student&apos;s <span className="font-mono">@pau.edu.ng</span> email to assign multiple roles without duplicating their account.
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Full Name (required for new accounts)
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Samuel Bassey"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Authorized Email (Gmail, Staff, or PAU Email)
                    </label>
                    <input
                      type="email"
                      required
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="samuel@gmail.com or student@pau.edu.ng"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Staff Delivery Phone Number (optional)
                    </label>
                    <input
                      type="tel"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="e.g. +234 803 482 1904"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Initial Password (optional for new account)
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Defaults to printhaus123 if blank"
                        className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((p) => !p)}
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {showNewPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Station / Desk
                    </label>
                    <input
                      type="text"
                      value={newDept}
                      onChange={(e) => setNewDept(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Assigned Roles
                    </label>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {(['student', 'staff', 'admin'] as const).map((r) => (
                        <label
                          key={r}
                          className={`flex items-center gap-1.5 px-2.5 py-2 border rounded-lg cursor-pointer capitalize ${
                            newRoles.includes(r)
                              ? 'border-blue-700 bg-blue-50 text-blue-900 font-semibold'
                              : 'border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={newRoles.includes(r)}
                            onChange={() => toggleNewRole(r)}
                            className="accent-blue-800"
                          />
                          <span>{r}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingAccount}
                    className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-medium rounded-lg cursor-pointer"
                  >
                    {savingAccount ? 'Saving...' : 'Save Staff / Role Assignment'}
                  </button>
                </form>

                {/* Authorized Staff & Activity Table */}
                <div className="lg:col-span-8 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">
                          Authorized Staff &amp; Collection Activity
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Search staff by name or email, manage multi-role permissions, or deactivate access immediately
                        </p>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={staffSearch}
                          onChange={(e) => setStaffSearch(e.target.value)}
                          placeholder="Search name or email..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <tr>
                            <th className="py-3 px-4">Staff Member</th>
                            <th className="py-3 px-4">Roles</th>
                            <th className="py-3 px-4">Collection Activity</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {staffRoster.map((s) => {
                            const roles = getUserRoles(s);
                            return (
                              <tr key={s.id} className="hover:bg-slate-50">
                                <td className="py-3 px-4">
                                  <p className="font-medium text-slate-900">{s.name}</p>
                                  <p className="font-mono text-[11px] text-slate-500">{s.email}</p>
                                  <p className="text-[11px] text-slate-500">{s.department || 'Print Desk'}</p>
                                  {editingPhoneId === s.id ? (
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                      <input
                                        type="tel"
                                        value={editingPhoneValue}
                                        onChange={(e) => setEditingPhoneValue(e.target.value)}
                                        placeholder="+234 803..."
                                        className="w-36 px-2 py-1 text-[11px] font-mono border border-slate-300 rounded bg-white"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void handleSaveStaffPhone(s)}
                                        className="px-2 py-1 text-[10px] font-semibold bg-slate-900 text-white rounded cursor-pointer"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingPhoneId(null)}
                                        className="px-1.5 py-1 text-[10px] text-slate-500 hover:text-slate-900 cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                                      <Phone className="w-3 h-3 text-blue-800 shrink-0" />
                                      <span className="font-mono text-slate-700">
                                        {s.phone || 'No phone set'}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingPhoneId(s.id);
                                          setEditingPhoneValue(s.phone || '');
                                        }}
                                        className="text-[10px] font-medium text-blue-800 hover:underline cursor-pointer"
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-wrap gap-1">
                                    {(['student', 'staff', 'admin'] as const).map((r) => {
                                      const active = roles.includes(r);
                                      return (
                                        <button
                                          key={r}
                                          type="button"
                                          onClick={() => void handleToggleUserRole(s, r)}
                                          title={`Click to ${active ? 'remove' : 'grant'} ${r} role`}
                                          className={`px-2 py-0.5 rounded font-mono uppercase text-[10px] border cursor-pointer ${
                                            active
                                              ? 'bg-blue-50 text-blue-900 border-blue-300 font-semibold'
                                              : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                                          }`}
                                        >
                                          {active ? `✓ ${r}` : `+ ${r}`}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td className="py-3 px-4 font-mono tabular-nums">
                                  <p className="font-semibold text-slate-900">
                                    {s.collectionStats?.totalCollections ?? 0} confirmed
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {s.collectionStats?.lastCollectedAt
                                      ? `Last: ${new Date(s.collectionStats.lastCollectedAt).toLocaleString()}`
                                      : 'No collections yet'}
                                  </p>
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={
                                      s.status === 'active'
                                        ? 'text-emerald-700 font-semibold'
                                        : 'text-red-700 font-semibold'
                                    }
                                  >
                                    {s.status === 'active' ? 'Active' : 'Deactivated'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                                  {roles.includes('staff') && s.id !== user.id && (
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleUserRole(s, 'staff')}
                                      className="px-2.5 py-1 text-[11px] font-medium text-amber-800 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded cursor-pointer"
                                    >
                                      Revoke Staff
                                    </button>
                                  )}
                                  {s.id !== user.id && (
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleUserStatus(s)}
                                      className="px-2.5 py-1 text-[11px] font-medium border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                                    >
                                      {s.status === 'active' ? 'Deactivate' : 'Reactivate'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* All Users / Assign Staff to Existing Students */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">
                          All Campus Accounts (Assign Multi-Role Permissions)
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Toggle roles directly on any existing PAU student to enable both Student and Staff dashboards under one login
                        </p>
                      </div>
                      <span className="text-xs font-mono text-slate-500 tabular-nums">
                        {filteredDirectoryUsers.length} user(s)
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <tr>
                            <th className="py-3 px-4">User</th>
                            <th className="py-3 px-4">Programme / Desk</th>
                            <th className="py-3 px-4">Roles (Click to Toggle)</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredDirectoryUsers.map((u) => {
                            const roles = getUserRoles(u);
                            return (
                              <tr key={u.id} className="h-12 hover:bg-slate-50">
                                <td className="px-4 py-2.5">
                                  <p className="font-medium text-slate-900">{u.name}</p>
                                  <p className="font-mono text-[11px] text-slate-500">{u.email}</p>
                                </td>
                                <td className="px-4 py-2.5 text-slate-700">
                                  <p>{u.department || '—'}</p>
                                  <p className="text-[11px] text-slate-500">
                                    {u.residency === 'on-campus'
                                      ? u.hostelName || 'On-Campus Hostel'
                                      : u.residency === 'off-campus'
                                        ? 'Off-Campus'
                                        : u.school || 'Operations'}
                                  </p>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {(['student', 'staff', 'admin'] as const).map((r) => {
                                      const active = roles.includes(r);
                                      return (
                                        <button
                                          key={r}
                                          type="button"
                                          onClick={() => void handleToggleUserRole(u, r)}
                                          className={`px-2 py-0.5 rounded font-mono uppercase text-[10px] border cursor-pointer ${
                                            active
                                              ? 'bg-blue-50 text-blue-900 border-blue-300 font-semibold'
                                              : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                                          }`}
                                        >
                                          {active ? `✓ ${r}` : `+ ${r}`}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span
                                    className={
                                      u.status === 'active'
                                        ? 'text-emerald-700 font-medium'
                                        : 'text-red-700 font-medium'
                                    }
                                  >
                                    {u.status}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {u.id !== user.id && (
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleUserStatus(u)}
                                      className="px-2.5 py-1 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                                    >
                                      {u.status === 'active' ? 'Deactivate' : 'Activate'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Recent Staff Collection Log */}
                  {recentCollections.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-slate-200">
                        <h3 className="text-sm font-semibold text-slate-900">
                          Recent Staff Collection Audit Feed
                        </h3>
                      </div>
                      <div className="divide-y divide-slate-200">
                        {recentCollections.slice(0, 6).map((c) => (
                          <div
                            key={c.id}
                            className="px-6 py-3 flex items-center justify-between gap-4 text-xs"
                          >
                            <div>
                              <span className="font-mono font-bold text-slate-900">
                                {c.orderCode}
                              </span>{' '}
                              · {c.studentName} · Confirmed by{' '}
                              <span className="font-semibold text-slate-900">{c.staffName}</span>
                            </div>
                            <span className="font-mono text-[11px] text-slate-500">
                              {new Date(c.collectedAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* COMPLAINTS & REFUNDS */}
          {activeTab === 'complaints' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h2 className="text-base font-semibold text-slate-900">
                  Student Complaints &amp; Refund Resolutions
                </h2>
              </div>
              {complaints.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No complaints submitted.</p>
              ) : (
                <div className="divide-y divide-slate-200">
                  {complaints.map((c) => (
                    <div key={c.id} className="p-6 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-slate-900">{c.orderCode}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-700 font-medium">{c.studentName}</span>
                        </div>
                        <span className="font-mono text-xs uppercase font-semibold text-slate-700">
                          {c.status}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{c.subject}</p>
                      <p className="text-xs text-slate-600">{c.description}</p>

                      {c.status === 'open' ? (
                        <div className="flex flex-col sm:flex-row gap-2 pt-2">
                          <input
                            type="text"
                            placeholder="Resolution note..."
                            value={resolutionMap[c.id] || ''}
                            onChange={(e) =>
                              setResolutionMap((prev) => ({ ...prev, [c.id]: e.target.value }))
                            }
                            className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                          />
                          <input
                            type="number"
                            placeholder="Refund ₦"
                            value={refundMap[c.id] ?? 300}
                            onChange={(e) =>
                              setRefundMap((prev) => ({
                                ...prev,
                                [c.id]: Number(e.target.value) || 0,
                              }))
                            }
                            className="w-28 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => void handleResolveComplaint(c, 'resolved')}
                            className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleResolveComplaint(c, 'refunded')}
                            className="px-3 py-1.5 text-xs font-medium bg-red-700 text-white rounded-lg cursor-pointer"
                          >
                            Issue Refund
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg">
                          {c.resolutionNote}
                          {c.refundAmount > 0 ? ` · Refunded ${formatNaira(c.refundAmount)}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
