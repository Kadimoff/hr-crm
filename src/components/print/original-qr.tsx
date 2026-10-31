import { qrSvg } from "@/lib/qr";

/** Çap vərəqində sistemdəki orijinala keçid: QR kod + link (skan edən daxil olub orijinala baxır) */
export async function OriginalQr({ url, label = "Orijinal sistemdə" }: { url: string; label?: string }) {
  const svg = await qrSvg(url);
  return (
    <div className="flex items-center gap-2.5 break-inside-avoid">
      {/* qrcode kitabxanasının SVG-si — url mətn kimi kodlanır, skript yoxdur */}
      <div className="size-[22mm] shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="max-w-[60mm] text-[9px] leading-tight text-neutral-600">
        <div className="font-semibold text-neutral-800">{label}</div>
        <div className="mt-0.5 font-mono break-all">{url}</div>
        <div className="mt-0.5">QR kodu skan edin və ya linki açın</div>
      </div>
    </div>
  );
}
