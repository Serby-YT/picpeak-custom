import React, { useRef } from 'react';
import { X, Download } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { Card, Button } from '../common';

interface GalleryQRCodeModalProps {
  eventName: string;
  url: string;
  onClose: () => void;
}

export const GalleryQRCodeModal: React.FC<GalleryQRCodeModalProps> = ({
  eventName,
  url,
  onClose
}) => {
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const canvas = canvasWrapperRef.current?.querySelector('canvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `${eventName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr-code.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="max-w-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-neutral-900">
            Gallery QR Code
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-neutral-600 mb-4">
          Scan to open <span className="font-medium">{eventName}</span> — handy to print or display at the event.
        </p>

        <div ref={canvasWrapperRef} className="flex justify-center bg-white p-4 rounded-lg border border-neutral-200 mb-4">
          <QRCodeCanvas value={url} size={220} level="M" includeMargin={false} />
        </div>

        <Button
          variant="primary"
          className="w-full justify-center"
          leftIcon={<Download className="w-4 h-4" />}
          onClick={handleDownload}
        >
          Download PNG
        </Button>
      </Card>
    </div>
  );
};
