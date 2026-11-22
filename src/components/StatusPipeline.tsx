import { Check, Clock, PackageCheck, Printer, ShieldCheck, XCircle } from 'lucide-react';
import { ORDER_STATUS_SEQUENCE, OrderStatus, StatusHistoryEntry } from '../types/printhaus';

interface StatusPipelineProps {
  currentStatus: OrderStatus;
  history?: StatusHistoryEntry[];
  rejectionReason?: string | null;
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const config: Record<OrderStatus, { label: string; classes: string }> = {
    order_received: {
      label: 'Order received',
      classes: 'text-slate-700 bg-slate-100 border-slate-200',
    },
    payment_confirmed: {
      label: 'Payment confirmed',
      classes: 'text-blue-800 bg-blue-50 border-blue-200',
    },
    printing_in_progress: {
      label: 'Printing in progress',
      classes: 'text-amber-800 bg-amber-50 border-amber-200',
    },
    quality_check: {
      label: 'Quality check',
      classes: 'text-indigo-800 bg-indigo-50 border-indigo-200',
    },
    ready_for_collection: {
      label: 'Ready for Pickup',
      classes: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    },
    collected: {
      label: 'Collected',
      classes: 'text-slate-800 bg-slate-100 border-slate-300',
    },
    rejected: {
      label: 'Rejected',
      classes: 'text-red-800 bg-red-50 border-red-200',
    },
  };

  const item = config[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 ${item.classes}`}
    >
      {item.label}
    </span>
  );
}

export function StatusPipeline({ currentStatus, history = [], rejectionReason }: StatusPipelineProps) {
  if (currentStatus === 'rejected') {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
        <XCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-900">Order rejected by printing desk</p>
          <p className="text-sm text-red-800 mt-1">
            {rejectionReason || 'Please re-upload a verified PDF or Word document and contact support.'}
          </p>
        </div>
      </div>
    );
  }

  const activeIndex = ORDER_STATUS_SEQUENCE.findIndex((s) => s.status === currentStatus);

  const iconFor = (status: OrderStatus) => {
    switch (status) {
      case 'order_received':
        return Clock;
      case 'payment_confirmed':
        return ShieldCheck;
      case 'printing_in_progress':
        return Printer;
      case 'quality_check':
        return Check;
      case 'ready_for_collection':
      case 'collected':
        return PackageCheck;
      default:
        return Clock;
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {ORDER_STATUS_SEQUENCE.map((step, idx) => {
          const isCompleted = idx < activeIndex || (idx === activeIndex && currentStatus === 'collected');
          const isCurrent = idx === activeIndex && currentStatus !== 'collected';
          const Icon = iconFor(step.status);
          const matchedHistory = history.find((h) => h.status === step.status);

          return (
            <div
              key={step.status}
              className={`p-3 rounded-lg border transition-colors ${
                isCurrent
                  ? 'border-blue-700 bg-blue-50/70'
                  : isCompleted
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  0{idx + 1}
                </span>
                <Icon
                  className={`w-4 h-4 ${
                    isCurrent
                      ? 'text-blue-700'
                      : isCompleted
                        ? 'text-emerald-700'
                        : 'text-slate-400'
                  }`}
                />
              </div>
              <p
                className={`text-xs font-semibold leading-snug ${
                  isCurrent || isCompleted ? 'text-slate-900' : 'text-slate-500'
                }`}
              >
                {step.label}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                {matchedHistory
                  ? new Date(matchedHistory.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : step.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
