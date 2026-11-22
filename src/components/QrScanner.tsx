import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Upload } from 'lucide-react';

interface QrScannerProps {
  onScan: (decodedText: string) => void;
  compact?: boolean;
}

export function QrScanner({ onScan, compact = false }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const scanFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width > 0 && height > 0) {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code && code.data) {
          const decoded = code.data.trim();
          setLastScanned(decoded);
          onScan(decoded);
          stopCamera();
          return;
        }
      }
    }

    rafRef.current = requestAnimationFrame(scanFrame);
  };

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Camera scanning is unavailable in this browser. Upload a QR image instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.play().catch(() => {});
          rafRef.current = requestAnimationFrame(scanFrame);
        }
      });
    } catch {
      setError('Camera permission denied or no camera detected. You can upload a QR image below.');
      stopCamera();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          setError('Unable to decode QR image.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          const decoded = code.data.trim();
          setLastScanned(decoded);
          onScan(decoded);
        } else {
          setError('No readable QR code detected in that image.');
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('Could not load the selected image.');
    };
    img.src = url;
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!cameraActive ? (
          <button
            type="button"
            onClick={startCamera}
            className="inline-flex items-center gap-2 py-2 px-4 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Open Camera Scanner</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={stopCamera}
            className="inline-flex items-center gap-2 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <CameraOff className="w-4 h-4" />
            <span>Stop Camera</span>
          </button>
        )}

        <label className="inline-flex items-center gap-2 py-2 px-4 bg-white border border-slate-300 hover:border-slate-900 text-slate-800 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer">
          <Upload className="w-4 h-4" />
          <span>Scan QR Image</span>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="sr-only"
          />
        </label>

        {lastScanned && (
          <span className="text-xs font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
            Scanned: {lastScanned}
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
          {error}
        </div>
      )}

      {cameraActive && (
        <div
          className={`relative overflow-hidden rounded-xl border border-slate-300 bg-slate-950 ${
            compact ? 'max-w-sm aspect-square' : 'max-w-md aspect-video'
          }`}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-44 h-44 border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
          </div>
          <p className="absolute bottom-2 inset-x-0 text-center text-[11px] font-mono text-white">
            Align PAU collection QR code inside frame
          </p>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
