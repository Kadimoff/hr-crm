/** Çap səhifələri: menyu yoxdur, ağ vərəq; brauzerin çap pəncərəsi A4 üçün hazırlanıb */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-muted py-6 print:bg-white print:py-0">{children}</div>;
}
