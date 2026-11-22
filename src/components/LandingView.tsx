import React, { useState } from 'react';
import { ArrowRight, Check, FileText, MapPin, Printer, QrCode, Search } from 'lucide-react';
import {
  BindingOption,
  ColorMode,
  PAU_FEMALE_HOSTELS,
  PAU_MALE_HOSTELS,
  PAU_OFF_CAMPUS_PICKUP_VENUES,
  PAU_SCHOOLS,
  PICKUP_OPERATING_HOURS,
  PICKUP_POLICY_RULES,
  PrintOrder,
  PricingConfig,
  SidedMode,
  UserAccount,
  calculateOrderPricing,
  formatNaira,
} from '../types/printhaus';
import { QrScanner } from './QrScanner';
import { StatusBadge, StatusPipeline } from './StatusPipeline';

interface LandingViewProps {
  pricing: PricingConfig;
  currentUser: UserAccount | null;
  onStartOrder: () => void;
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onEnterPortal: () => void;
}

const HERO_IMG = '/src/assets/images/hero_printhaus_campus_1795070895275.jpg';
const SERVICES_IMG = '/src/assets/images/service_binding_reports_1795070895683.jpg';
const PICKUP_IMG = '/src/assets/images/pickup_campus_counter_1795070895624.jpg';

function ResilientImage({
  src,
  alt,
  className,
  fallbackTitle,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 border border-slate-200 text-slate-600 p-8 ${className}`}
      >
        <Printer className="w-8 h-8 text-blue-800 mb-3" />
        <p className="text-sm font-medium text-slate-900">{fallbackTitle}</p>
        <p className="text-xs text-slate-500 mt-1">Pan-Atlantic University · PrintHaus</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

export function LandingView({
  pricing,
  currentUser,
  onStartOrder,
  onOpenAuth,
  onEnterPortal,
}: LandingViewProps) {
  // Interactive Price Estimator state
  const [estPages, setEstPages] = useState(20);
  const [estCopies, setEstCopies] = useState(1);
  const [estColor, setEstColor] = useState<ColorMode>('bw');
  const [estSided, setEstSided] = useState<SidedMode>('single');
  const [estBinding, setEstBinding] = useState<BindingOption>('none');
  const [estUrgent, setEstUrgent] = useState(false);

  const estimate = calculateOrderPricing(
    estPages,
    {
      copies: estCopies,
      colorMode: estColor,
      sided: estSided,
      binding: estBinding,
      lamination: false,
      urgent: estUrgent,
      notes: '',
    },
    pricing,
    false
  );

  // Live Order Tracker state
  const [trackCode, setTrackCode] = useState('PH-2048');
  const [trackedOrder, setTrackedOrder] = useState<PrintOrder | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [showQrTracker, setShowQrTracker] = useState(false);

  const handleTrackOrder = async (e?: React.FormEvent, overrideCode?: string) => {
    if (e) e.preventDefault();
    const query = (overrideCode ?? trackCode).trim();
    if (!query) return;
    setTrackingLoading(true);
    setTrackError(null);
    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        setTrackedOrder(null);
        setTrackError(data.error || 'Order not found.');
      } else {
        setTrackedOrder(data.order);
      }
    } catch {
      setTrackError('Unable to check order status right now.');
    } finally {
      setTrackingLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-900">
      {/* Top Bar Contract: Brand wordmark — 4-5 links — 1 primary CTA */}
      <header className="sticky top-0 z-40 bg-[#FAF9F6]/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            PrintHaus
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#services"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Services
            </a>
            <a
              href="#pricing"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Pricing
            </a>
            <a
              href="#campus-pickup"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Campus Pickup
            </a>
            <a
              href="#track-order"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Track Order
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={currentUser ? onEnterPortal : () => onOpenAuth('login')}
              className="py-2 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {currentUser ? 'Open Portal' : 'Order Print'}
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Section: Asymmetric 2-Column Split */}
        <section className="max-w-7xl mx-auto px-6 pt-12 pb-10 lg:pt-16 lg:pb-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between py-2">
              <div>
                <p className="text-xs font-medium text-slate-500 mb-4">
                  Pan-Atlantic University · Ibeju-Lekki Campus
                </p>
                <h1
                  className="font-display font-bold tracking-tight text-slate-950 leading-[1.05]"
                  style={{ fontSize: 'clamp(2.35rem, 4.2vw, 3.75rem)', textWrap: 'balance' }}
                >
                  Printing Made Simple for PAU Students.
                </h1>
                <p className="mt-6 text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                  Upload your PDF or Word documents from your hostel or off-campus home, see exact
                  Naira pricing before paying, track every stage live, and collect at the central
                  campus pickup desk.
                </p>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={onStartOrder}
                  className="inline-flex items-center gap-2 py-3 px-6 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Start Print Order</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="#track-order"
                  className="inline-flex items-center gap-2 py-3 px-5 bg-white border border-slate-300 hover:border-slate-900 text-slate-900 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Track an Order
                </a>
                <span className="text-xs text-slate-500">
                  {pricing.firstOrderDiscountPct}% off your first PAU student order
                </span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[320px] lg:min-h-[440px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                <ResilientImage
                  src={HERO_IMG}
                  alt="Neatly bound academic papers and Kraft pickup folders at the PrintHaus campus counter"
                  fallbackTitle="PrintHaus Campus Print & Pickup Counter"
                  className="w-full h-full lg:h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-Column Service Snapshot Strip below Hero Split */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-xl bg-white divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-5">
              <p className="font-mono text-xs text-slate-500">01 / CONVENIENCE</p>
              <p className="text-sm font-semibold text-slate-900 mt-1.5">Order Anywhere</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Submit assignments the night before a 10 AM lecture from hostels or off-campus.
              </p>
            </div>
            <div className="p-5">
              <p className="font-mono text-xs text-slate-500">02 / TRANSPARENCY</p>
              <p className="text-sm font-semibold text-slate-900 mt-1.5">Upfront Naira Rates</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Automatic page detection and instant itemized totals from {formatNaira(pricing.bwSinglePerPage)}/page.
              </p>
            </div>
            <div className="p-5">
              <p className="font-mono text-xs text-slate-500">03 / RELIABILITY</p>
              <p className="text-sm font-semibold text-slate-900 mt-1.5">Primary & Backup Press</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Managed partner network with mandatory 6-point quality control before dispatch.
              </p>
            </div>
            <div className="p-5">
              <p className="font-mono text-xs text-slate-500">04 / COLLECTION</p>
              <p className="text-sm font-semibold text-slate-900 mt-1.5">Central PAU Pickup</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Collect sealed folders at the campus desk with your unique QR code and order slip.
              </p>
            </div>
          </div>
        </section>

        {/* Services & Workflow Section */}
        <section id="services" className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-200">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            <div className="lg:col-span-5">
              <p className="text-xs font-medium text-blue-800 mb-2">Core Services & Process</p>
              <h2
                className="font-display text-3xl font-bold tracking-tight text-slate-950"
                style={{ textWrap: 'balance' }}
              >
                Built for coursework, lecture notes, and final-year projects.
              </h2>
              <p className="mt-4 text-sm text-slate-600 leading-relaxed">
                PrintHaus replaces long queues, unpredictable shop hours, and surprise pricing with
                a structured nine-step fulfilment workflow verified at every handoff.
              </p>

              <div className="mt-6 rounded-xl overflow-hidden border border-slate-200 bg-white">
                <ResilientImage
                  src={SERVICES_IMG}
                  alt="Bound university final-year project reports and color academic diagrams beside 80gsm paper"
                  fallbackTitle="Academic Binding & Colour Print Studio"
                  className="w-full aspect-[4/3] object-cover"
                />
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  {
                    num: '01.',
                    title: 'Black & White Printing',
                    desc: 'Crisp 80gsm A4 laser output for assignments, reading packs, and exam materials.',
                    meta: `${formatNaira(pricing.bwSinglePerPage)} single · ${formatNaira(pricing.bwDoublePerPage)} double`,
                  },
                  {
                    num: '02.',
                    title: 'Colour Presentations',
                    desc: 'Accurate diagrams, charts, architectural renders, and seminar slide decks.',
                    meta: `${formatNaira(pricing.colorSinglePerPage)} single · ${formatNaira(pricing.colorDoublePerPage)} double`,
                  },
                  {
                    num: '03.',
                    title: 'Binding & Finishing',
                    desc: 'Corner stapling, durable spiral coil binding with clear covers (flat rate for the entire copy), and lamination.',
                    meta: `From ${formatNaira(pricing.stapling)} stapling · ${formatNaira(pricing.spiralBinding)} spiral/copy`,
                  },
                  {
                    num: '04.',
                    title: 'Bulk & Friend Orders',
                    desc: 'Add multiple different documents in one order—for yourself, coursemates, or student orgs—with automatic bulk savings.',
                    meta: `${pricing.bulkDiscountPct}% off print pages for ${pricing.bulkThresholdDocuments}+ documents`,
                  },
                ].map((item) => (
                  <div key={item.num} className="p-6 bg-white border border-slate-200 rounded-xl">
                    <p className="font-mono text-xs text-slate-500">{item.num}</p>
                    <h3 className="text-base font-semibold text-slate-900 mt-2">{item.title}</h3>
                    <p className="text-sm text-slate-600 mt-2 leading-relaxed">{item.desc}</p>
                    <p className="font-mono text-xs text-blue-800 mt-4 tabular-nums">{item.meta}</p>
                  </div>
                ))}
              </div>

              {/* How It Works Compact Strip */}
              <div className="p-6 bg-white border border-slate-200 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 mb-4">
                  How PrintHaus delivers every order
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-xs text-slate-600">
                  <div>
                    <span className="font-mono text-slate-900 font-semibold">1. Upload & Price</span>
                    <p className="mt-1 leading-relaxed">
                      Upload PDF or Word files, preview pages, choose options, and view exact Naira cost before paying.
                    </p>
                  </div>
                  <div>
                    <span className="font-mono text-slate-900 font-semibold">2. Print & Inspect</span>
                    <p className="mt-1 leading-relaxed">
                      Our primary press prints your document and runs a 6-point check for missing pages and orientation.
                    </p>
                  </div>
                  <div>
                    <span className="font-mono text-slate-900 font-semibold">3. Seal & Collect</span>
                    <p className="mt-1 leading-relaxed">
                      Orders are labelled in Kraft sleeves and held at the PAU Pickup Counter until you show your QR code.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Interactive Pricing Estimator */}
        <section id="pricing" className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-200">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5">
              <p className="text-xs font-medium text-blue-800 mb-2">Transparent Pricing</p>
              <h2
                className="font-display text-3xl font-bold tracking-tight text-slate-950"
                style={{ textWrap: 'balance' }}
              >
                Calculate your exact print cost before you upload.
              </h2>
              <p className="mt-4 text-sm text-slate-600 leading-relaxed">
                No haggling at the counter. Every specification adjusts your Naira total in real
                time, with automatic bulk savings for large project reports and student societies.
              </p>

              <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">
                    Standard PAU Rate Card
                  </span>
                  <span className="text-xs font-mono text-slate-500">NGN (₦)</span>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-200">
                    <tr className="h-10">
                      <td className="px-5 text-slate-700">B&W Single-Sided (per page)</td>
                      <td className="px-5 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatNaira(pricing.bwSinglePerPage)}
                      </td>
                    </tr>
                    <tr className="h-10">
                      <td className="px-5 text-slate-700">B&W Double-Sided (per page)</td>
                      <td className="px-5 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatNaira(pricing.bwDoublePerPage)}
                      </td>
                    </tr>
                    <tr className="h-10">
                      <td className="px-5 text-slate-700">Colour Single-Sided (per page)</td>
                      <td className="px-5 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatNaira(pricing.colorSinglePerPage)}
                      </td>
                    </tr>
                    <tr className="h-10">
                      <td className="px-5 text-slate-700">Spiral Binding (entire copy)</td>
                      <td className="px-5 text-right font-mono tabular-nums font-medium text-slate-900">
                        {formatNaira(pricing.spiralBinding)}
                      </td>
                    </tr>
                    <tr className="h-10">
                      <td className="px-5 text-slate-700">
                        Bulk Discount ({pricing.bulkThresholdDocuments}+ documents)
                      </td>
                      <td className="px-5 text-right font-mono tabular-nums font-medium text-emerald-700">
                        {pricing.bulkDiscountPct}% off print
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Instant Cost Estimator</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Try 20 B&W pages ({formatNaira(20 * pricing.bwSinglePerPage)}) or {pricing.bulkThresholdDocuments}+ copies for {pricing.bulkDiscountPct}% bulk savings
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Estimated Total</p>
                  <p className="font-display text-3xl font-bold text-slate-950 font-mono tabular-nums">
                    {formatNaira(estimate.totalAmount)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-6">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Document Pages
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={estPages}
                    onChange={(e) => setEstPages(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Copies</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={estCopies}
                    onChange={(e) => setEstCopies(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Print Colour
                  </label>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setEstColor('bw')}
                      className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        estColor === 'bw'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Black & White
                    </button>
                    <button
                      type="button"
                      onClick={() => setEstColor('color')}
                      className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        estColor === 'color'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Full Colour
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Page Sides
                  </label>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setEstSided('single')}
                      className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        estSided === 'single'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Single-Sided
                    </button>
                    <button
                      type="button"
                      onClick={() => setEstSided('double')}
                      className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        estSided === 'double'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Double-Sided
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Binding Option
                  </label>
                  <select
                    value={estBinding}
                    onChange={(e) => setEstBinding(e.target.value as BindingOption)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                  >
                    <option value="none">No binding ({formatNaira(0)})</option>
                    <option value="stapling">Corner stapling ({formatNaira(pricing.stapling)}/copy)</option>
                    <option value="spiral">Spiral binding ({formatNaira(pricing.spiralBinding)} entire copy)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg cursor-pointer hover:border-slate-400">
                    <span className="text-xs font-medium text-slate-700">
                      Priority Urgent Turnaround (+{formatNaira(pricing.urgentFee)})
                    </span>
                    <input
                      type="checkbox"
                      checked={estUrgent}
                      onChange={(e) => setEstUrgent(e.target.checked)}
                      className="w-4 h-4 accent-blue-800"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-xs text-slate-600 space-y-1 font-mono tabular-nums">
                  <p>
                    {estimate.totalPages} total pages × {formatNaira(estimate.perPageRate)} ={' '}
                    {formatNaira(estimate.printCost)}
                    {estimate.finishingCost > 0 && ` + ${formatNaira(estimate.finishingCost)} finishing`}
                    {estimate.urgentFee > 0 && ` + ${formatNaira(estimate.urgentFee)} urgent`}
                  </p>
                  {estimate.discountAmount > 0 && (
                    <p className="text-emerald-700">
                      Discount applied: -{formatNaira(estimate.discountAmount)} ({estimate.discountReason})
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onStartOrder}
                  className="py-2.5 px-5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Upload & Place Order
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Campus Pickup & Live Order Tracker */}
        <section
          id="campus-pickup"
          className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-200"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 rounded-xl overflow-hidden border border-slate-200 bg-white">
              <ResilientImage
                src={PICKUP_IMG}
                alt="Organized university campus pickup counter with Kraft document envelopes in numbered cubbies"
                fallbackTitle="PAU Central Campus Pickup Counter"
                className="w-full h-full min-h-[280px] lg:h-full object-cover"
              />
            </div>

            <div className="lg:col-span-6 flex flex-col justify-between bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
              <div>
                <p className="text-xs font-medium text-blue-800 mb-2">
                  Central Campus Collection Point
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
                  Zero vehicles, zero queues before 10 AM lectures.
                </h2>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                  Whether you live in an on-campus hostel or commute from Lekki/Ajah, upload your
                  work the evening prior and pick up your sealed Kraft folder from the PAU Central
                  Pickup Counter.
                </p>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <MapPin className="w-4 h-4 text-blue-800" />
                      <span>Pickup Venues & Policy</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      <span className="font-semibold">Off-Campus:</span>{' '}
                      {PAU_OFF_CAMPUS_PICKUP_VENUES.join(' · ')}
                    </p>
                    <p className="text-slate-700 leading-relaxed">
                      <span className="font-semibold">On-Campus:</span> Select any Male Hostel or
                      Female Hostel at checkout.
                    </p>
                    <ul className="space-y-1.5 pt-2 border-t border-slate-200 text-slate-700">
                      {PICKUP_POLICY_RULES.map((rule) => (
                        <li key={rule} className="flex items-start gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                          <span>{rule}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="flex items-center gap-2 font-semibold text-slate-900 mb-2">
                      <FileText className="w-4 h-4 text-blue-800" />
                      <span>Operating Hours</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <tbody className="divide-y divide-slate-200">
                        {PICKUP_OPERATING_HOURS.map((row) => (
                          <tr key={row.day} className="h-6">
                            <td className="text-slate-700 font-medium">{row.day}</td>
                            <td
                              className={`text-right font-mono tabular-nums ${
                                row.hours === 'Closed' ? 'text-slate-400' : 'text-slate-900'
                              }`}
                            >
                              {row.hours}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500">
                  No fixed pickup windows — present your <span className="font-mono text-slate-800">PH-XXXX</span> order number or <span className="font-mono text-slate-800">PAU-XXXX</span> QR slip anytime during operating hours.
                </span>
              </div>
            </div>
          </div>

          {/* Live Order Tracker */}
          <div id="track-order" className="mt-12 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
              <div>
                <h3 className="font-display text-xl font-bold text-slate-950">
                  Live Order Status Tracker
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Enter your Order ID (e.g. <button type="button" onClick={() => { setTrackCode('PH-2048'); handleTrackOrder(undefined, 'PH-2048'); }} className="font-mono text-blue-800 underline cursor-pointer">PH-2048</button>,{' '}
                  <button type="button" onClick={() => { setTrackCode('PH-2049'); handleTrackOrder(undefined, 'PH-2049'); }} className="font-mono text-blue-800 underline cursor-pointer">PH-2049</button>) or Collection Code (<button type="button" onClick={() => { setTrackCode('PAU-7392'); handleTrackOrder(undefined, 'PAU-7392'); }} className="font-mono text-blue-800 underline cursor-pointer">PAU-7392</button>)
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <form onSubmit={handleTrackOrder} className="flex items-center gap-2 flex-1 md:flex-initial">
                  <div className="relative flex-1 md:w-56">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={trackCode}
                      onChange={(e) => setTrackCode(e.target.value)}
                      placeholder="PH-2048 or PAU-7392"
                      className="w-full pl-9 pr-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={trackingLoading}
                    className="py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {trackingLoading ? 'Checking...' : 'Check Status'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => setShowQrTracker((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 py-2 px-3.5 border border-slate-300 hover:border-slate-900 text-slate-800 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>{showQrTracker ? 'Close Scanner' : 'Scan QR'}</span>
                </button>
              </div>
            </div>

            {showQrTracker && (
              <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <p className="text-xs font-semibold text-slate-900">
                  Scan your PrintHaus QR slip to check status
                </p>
                <QrScanner
                  onScan={(decoded) => {
                    setTrackCode(decoded);
                    setShowQrTracker(false);
                    handleTrackOrder(undefined, decoded);
                  }}
                />
              </div>
            )}

            {trackError && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                {trackError}
              </div>
            )}

            {trackedOrder ? (
              <div className="mt-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-base font-bold text-slate-950">
                        {trackedOrder.orderCode}
                      </span>
                      <StatusBadge status={trackedOrder.status} />
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      {trackedOrder.fileName} · {trackedOrder.pageCount} pages · {trackedOrder.specs.copies}x ·{' '}
                      Pickup: {trackedOrder.pickupVenue}
                      {trackedOrder.pickupShelf ? ` (${trackedOrder.pickupShelf})` : ''}
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <p className="text-xs text-slate-500">Total Paid</p>
                    <p className="text-base font-bold text-slate-950 tabular-nums">
                      {formatNaira(trackedOrder.pricingBreakdown.totalAmount)}
                    </p>
                  </div>
                </div>

                <StatusPipeline
                  currentStatus={trackedOrder.status}
                  history={trackedOrder.statusHistory}
                  rejectionReason={trackedOrder.rejectionReason}
                />
              </div>
            ) : (
              !trackError && (
                <div className="mt-6 text-xs text-slate-500 flex items-center justify-between">
                  <span>Click any sample code above or enter your receipt ID to view live progress.</span>
                </div>
              )
            )}
          </div>
        </section>

        {/* PAU Programmes & On-Campus Hostels Coverage */}
        <section className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-200">
          <div className="max-w-2xl mb-8">
            <p className="text-xs font-medium text-blue-800 mb-2">PAU Campus Directory</p>
            <h2
              className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950"
              style={{ textWrap: 'balance' }}
            >
              Tailored for every PAU School, Programme, and On-Campus Hostel.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
                Pan-Atlantic University Schools & Programmes
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
                {PAU_SCHOOLS.map((group) => (
                  <div key={group.school}>
                    <p className="text-xs font-semibold text-blue-900">{group.school}</p>
                    <ol className="mt-2 space-y-1 text-xs text-slate-600 list-decimal list-inside">
                      {group.programmes.map((prog) => (
                        <li key={prog}>{prog}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <h3 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
                On-Campus Residence Coverage
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                <div>
                  <p className="font-semibold text-slate-900">Male Hostels</p>
                  <ul className="mt-2 space-y-1.5 text-slate-600">
                    {PAU_MALE_HOSTELS.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Female Hostels</p>
                  <ul className="mt-2 space-y-1.5 text-slate-600">
                    {PAU_FEMALE_HOSTELS.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Comparison Table */}
        <section className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-200">
          <div className="max-w-2xl mb-8">
            <p className="text-xs font-medium text-blue-800 mb-2">Why Students Switch</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
              Traditional printing shops vs. PrintHaus
            </h2>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                  <th className="py-3.5 px-5">Experience Area</th>
                  <th className="py-3.5 px-5">Traditional Printing Shop</th>
                  <th className="py-3.5 px-5 text-blue-900">PrintHaus PAU Platform</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {[
                  ['Placing orders', 'Walk to the shop and queue physically', 'Upload PDF or Word online from anywhere'],
                  ['Price visibility', 'Ask attendant after printing', 'Exact Naira total shown before confirmation'],
                  ['Order status', 'Follow up repeatedly in person', '6-stage live tracking & ready notifications'],
                  ['Document collection', 'Make an extra trip back to the shop', 'Central PAU Pickup Desk with QR code'],
                  ['Supply reliability', 'Single shop delays if paper or toner runs out', 'Primary + Backup printing partners monitored daily'],
                ].map(([area, trad, ph]) => (
                  <tr key={area} className="h-12">
                    <td className="px-5 font-medium text-slate-900">{area}</td>
                    <td className="px-5 text-slate-500">{trad}</td>
                    <td className="px-5 text-slate-900 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>{ph}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <p className="font-display text-lg font-bold text-slate-950">PrintHaus</p>
            <p className="text-xs text-slate-500 mt-1">
              Printing Made Simple · Pan-Atlantic University, Ibeju-Lekki, Lagos
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-600">
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Student Portal Sign In
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Printing Staff Console
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Administrator Console
            </button>
            <span className="text-slate-400">Mon–Fri 8AM–5PM · Sat 9AM–2PM</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
