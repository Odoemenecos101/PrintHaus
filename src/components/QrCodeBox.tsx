import { useEffect, useState } from 'react';
import { Download, Maximize2, X } from 'lucide-react';
import QRCode from 'qrcode';

interface QrCodeBoxProps {
  value: string;
  displayCode?: string;
  size?: number;
  label?: string;
  downloadable?: boolean;
  enlargeable?: boolean;
}

export function QrCodeBox({
  value,
  displayCode,
  size = 128,
  label,
  downloadable = false,
  enlargeable = false,
}: QrCodeBoxProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [largeDataUrl, setLargeDataUrl] = useState<string>('');
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: Math.max(size * 2, 240),
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });

    if (enlargeable) {
      QRCode.toDataURL(value, {
        width: 560,
        margin: 3,
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      })
        .then((url) => {
          if (active) setLargeDataUrl(url);
        })
        .catch(() => {
          if (active) setLargeDataUrl('');
        });
    }

    return () => {
      active = false;
    };
  }, [value, size, enlargeable]);

  const caption = displayCode || value;

  return (
    <>
      <div className="inline-flex flex-col items-center gap-2 bg-white p-3 border border-slate-200 rounded-lg">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={label || `Collection QR code for ${caption}`}
            width={size}
            height={size}
            className="block"
          />
        ) : (
          <div
            style={{ width: size, height: size }}
            className="flex items-center justify-center bg-slate-100 text-slate-500 text-xs font-mono"
          >
            {caption}
          </div>
        )}
        <span className="font-mono text-xs font-semibold tracking-wider text-slate-900 tabular-nums text-center">
          {caption}
        </span>
        {(downloadable || enlargeable) && dataUrl && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {enlargeable && (
              <button
                type="button"
                onClick={() => setEnlarged(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-800 hover:text-blue-900 cursor-pointer"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Enlarge QR</span>
              </button>
            )}
            {downloadable && (
              <a
                href={dataUrl}
                download={`PrintHaus-${caption.replace(/[^a-zA-Z0-9_-]/g, '-')}.png`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 hover:text-blue-950"
              >
                <Download className="w-3 h-3" />
                <span>Save PNG</span>
              </a>
            )}
          </div>
        )}
      </div>

      {enlarged && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged PrintHaus Collection QR Code"
        >
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 space-y-4 text-center">
            <div className="flex items-center justify-between">
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-950">Campus Pickup QR Pass</p>
                <p className="text-xs text-slate-500">Present this code to PrintHaus staff</p>
              </div>
              <button
                type="button"
                onClick={() => setEnlarged(false)}
                aria-label="Close enlarged QR code"
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col items-center">
              {largeDataUrl || dataUrl ? (
                <img
                  src={largeDataUrl || dataUrl}
                  alt={label || `Large collection QR code for ${caption}`}
                  className="w-64 h-64 object-contain"
                />
              ) : null}
              <p className="mt-3 font-mono text-base font-bold tracking-wider text-slate-950">
                {caption}
              </p>
            </div>

            <p className="text-[11px] text-slate-500">
              Increase screen brightness if scanning at the pickup counter.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
