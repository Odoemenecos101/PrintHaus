import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import QRCode from 'qrcode';

interface QrCodeBoxProps {
  value: string;
  size?: number;
  label?: string;
  downloadable?: boolean;
}

export function QrCodeBox({ value, size = 128, label, downloadable = false }: QrCodeBoxProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
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
    return () => {
      active = false;
    };
  }, [value, size]);

  return (
    <div className="inline-flex flex-col items-center gap-2 bg-white p-3 border border-slate-200 rounded-lg">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={label || `Collection QR code for ${value}`}
          width={size}
          height={size}
          className="block"
        />
      ) : (
        <div
          style={{ width: size, height: size }}
          className="flex items-center justify-center bg-slate-100 text-slate-500 text-xs font-mono"
        >
          {value}
        </div>
      )}
      <span className="font-mono text-xs font-semibold tracking-wider text-slate-900 tabular-nums">
        {value}
      </span>
      {downloadable && dataUrl && (
        <a
          href={dataUrl}
          download={`PrintHaus-${value}.png`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 hover:text-blue-950"
        >
          <Download className="w-3 h-3" />
          <span>Save QR PNG</span>
        </a>
      )}
    </div>
  );
}
