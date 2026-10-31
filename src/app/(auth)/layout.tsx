export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          {/* Açıq temada orijinal rəng, qaranlıqda ağ */}
          <img src="/logo.png" alt="ASOİU — Azərbaycan Dövlət Neft və Sənaye Universiteti" width={1000} height={347} className="h-16 w-auto dark:hidden" />
          <img src="/logo-white.png" alt="" aria-hidden width={1000} height={347} className="hidden h-16 w-auto dark:block" />
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">HR CRM</span> · Kadr və əməkhaqqı sistemi
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
