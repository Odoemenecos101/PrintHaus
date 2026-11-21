import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  LogOut,
  MessageSquareWarning,
  Sliders,
  Users,
} from 'lucide-react';
import {
  ComplaintTicket,
  PrintOrder,
  PricingConfig,
  PrintingPartner,
  UserAccount,
  formatNaira,
} from '../types/printhaus';
import { StatusBadge } from './StatusPipeline';

interface AdminPortalProps {
  user: UserAccount;
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

export function AdminPortal({
  user,
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
  const [complaints, setComplaints] = useState<ComplaintTicket[]>([]);
  const [draftPricing, setDraftPricing] = useState<PricingConfig>(pricing);
  const [pricingSaved, setPricingSaved] = useState(false);

  // New staff form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDept, setNewDept] = useState('Campus Pickup Desk');

  // Refund / resolution state
  const [resolutionMap, setResolutionMap] = useState<Record<string, string>>({});
  const [refundMap, setRefundMap] = useState<Record<string, number>>({});

  const loadAdminData = async () => {
    const [ovRes, ordRes, ptrRes, usrRes, cmpRes] = await Promise.all([
      fetch('/api/admin/overview'),
      fetch('/api/orders'),
      fetch('/api/admin/partners'),
      fetch('/api/admin/users'),
      fetch('/api/complaints'),
    ]);
    const [ovData, ordData, ptrData, usrData, cmpData] = await Promise.all([
      ovRes.json(),
      ordRes.json(),
      ptrRes.json(),
      usrRes.json(),
      cmpRes.json(),
    ]);
    setMetrics(ovData.metrics);
    setOrders(ordData.orders || []);
    setPartners(ptrData.partners || []);
    setUsers(usrData.users || []);
    setComplaints(cmpData.complaints || []);
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  useEffect(() => {
    setDraftPricing(pricing);
  }, [pricing]);

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/pricing', {
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
    await fetch(`/api/admin/partners/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadAdminData();
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) return;
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        email: newEmail,
        department: newDept,
        role: 'staff',
      }),
    });
    if (res.ok) {
      setNewName('');
      setNewEmail('');
      await loadAdminData();
    }
  };

  const handleToggleUserStatus = async (u: UserAccount) => {
    const nextStatus = u.status === 'active' ? 'suspended' : 'active';
    await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    await loadAdminData();
  };

  const handleResolveComplaint = async (c: ComplaintTicket, status: 'resolved' | 'refunded') => {
    await fetch(`/api/complaints/${c.id}`, {
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
            <p className="text-xs text-slate-500 mt-0.5">{user.department || 'Operations Lead'}</p>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {[
              { id: 'overview' as const, label: 'Revenue & Orders', icon: BarChart3 },
              { id: 'pricing' as const, label: 'Pricing Rules', icon: Sliders },
              { id: 'partners' as const, label: 'Printing Partners', icon: Building2 },
              { id: 'accounts' as const, label: 'Accounts & Staff', icon: Users },
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
            <span className="text-slate-900 font-medium capitalize">{activeTab}</span>
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
                  <p className="text-xs text-slate-500">Partner & Operating Costs</p>
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
                    After partner, envelope & ops allocation
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
                    All Campus Orders & Unit Economics
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
                    Platform Printing Prices & Discounts (₦)
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
                        handlePartnerStatus(p.id, e.target.value as PrintingPartner['status'])
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
                      <span className="text-slate-500 font-sans">B&W Cost</span>
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

          {/* ACCOUNTS & STAFF */}
          {activeTab === 'accounts' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleAddStaff}
                className="lg:col-span-4 p-6 bg-white border border-slate-200 rounded-xl space-y-4"
              >
                <h2 className="text-base font-semibold text-slate-900">Add Printing Staff</h2>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Samuel Bassey"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="samuel@printhaus.ng"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Station</label>
                  <input
                    type="text"
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  Create Staff Account
                </button>
              </form>

              <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-base font-semibold text-slate-900">
                    Students & Operations Roster
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-3 px-4">Name</th>
                        <th className="py-3 px-4">Programme & Residence</th>
                        <th className="py-3 px-4">Role</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {users.map((u) => (
                        <tr key={u.id} className="h-12">
                          <td className="px-4">
                            <p className="font-medium text-slate-900">{u.name}</p>
                            <p className="font-mono text-[11px] text-slate-500">{u.email}</p>
                          </td>
                          <td className="px-4 text-slate-700">
                            <p>{u.department || '—'}</p>
                            <p className="text-[11px] text-slate-500">
                              {u.residency === 'on-campus'
                                ? u.hostelName || 'On-Campus Hostel'
                                : u.residency === 'off-campus'
                                  ? 'Off-Campus'
                                  : u.school || 'Operations'}
                            </p>
                          </td>
                          <td className="px-4 uppercase font-mono">{u.role}</td>
                          <td className="px-4">
                            <span
                              className={
                                u.status === 'active' ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'
                              }
                            >
                              {u.status}
                            </span>
                          </td>
                          <td className="px-4 text-right">
                            {u.id !== user.id && (
                              <button
                                type="button"
                                onClick={() => handleToggleUserStatus(u)}
                                className="px-2.5 py-1 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                              >
                                {u.status === 'active' ? 'Suspend' : 'Activate'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* COMPLAINTS & REFUNDS */}
          {activeTab === 'complaints' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h2 className="text-base font-semibold text-slate-900">
                  Student Complaints & Refund Resolutions
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
                            onClick={() => handleResolveComplaint(c, 'resolved')}
                            className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveComplaint(c, 'refunded')}
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
