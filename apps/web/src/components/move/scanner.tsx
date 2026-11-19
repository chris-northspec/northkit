'use client';

import { Camera, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// A camera scanner for the QR labels (S3-2): the browser's own detector where it has one
// (Chrome on Android), otherwise jsQR (Apache-2.0, in this bundle: nothing is fetched). The
// camera stays on this phone; no frame is sent anywhere. Where there is no camera, or the
// person says no, the search box beside it does the same job by asset number.

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (options: { formats: string[] }) => Detector;

export function CameraScanner({
  onCode,
  label = 'Scan a label',
  keepOpen = false,
}: {
  onCode: (code: string) => void;
  label?: string;
  /** Stay open after a scan (bulk). */
  keepOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = '';
    let lastAt = 0;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) return;
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
        const detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const tick = async () => {
          if (stopped) return;
          try {
            let value: string | undefined;
            if (detector) value = (await detector.detect(el))[0]?.rawValue;
            else if (jsQR && el.videoWidth) {
              canvas.width = el.videoWidth;
              canvas.height = el.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
              ctx.drawImage(el, 0, 0);
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              value = jsQR(image.data, image.width, image.height)?.data;
            }
            // The same label seen again within two seconds is one scan.
            if (value && (value !== last || Date.now() - lastAt > 2000)) {
              last = value;
              lastAt = Date.now();
              onCodeRef.current(value);
              if (!keepOpen) {
                setOpen(false);
                return;
              }
            }
          } catch {
            // A frame that can't be read: try the next.
          }
          timer = setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch {
        setProblem(
          'The camera isn’t available. Type the asset number in the box instead, or allow the camera in your browser’s settings.',
        );
        setOpen(false);
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, keepOpen]);

  return (
    <div className="stack">
      {open ? (
        <div className="scan-camera">
          <video ref={video} muted playsInline aria-label="Camera view" />
          <div className="scan-frame" aria-hidden="true" />
        </div>
      ) : null}
      <button
        type="button"
        className="scan-btn"
        onClick={() => {
          setProblem(null);
          setOpen((v) => !v);
        }}
        aria-pressed={open}
      >
        {open ? (
          <X size={22} className="icon" aria-hidden="true" />
        ) : (
          <Camera size={22} className="icon" aria-hidden="true" />
        )}
        {open ? 'Stop the camera' : label}
      </button>
      {problem ? (
        <p className="scan-error" role="alert">
          <span>{problem}</span>
        </p>
      ) : null}
    </div>
  );
}
