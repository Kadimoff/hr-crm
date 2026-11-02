import Link from "next/link";

export const metadata = { title: "Səhifə tapılmadı" };

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-5xl font-semibold text-muted-foreground">404</div>
      <h1 className="text-lg font-semibold">Səhifə tapılmadı</h1>
      <p className="max-w-md text-sm text-muted-foreground">Axtardığınız səhifə və ya qeyd mövcud deyil, silinib və ya ona baxmaq üçün icazəniz yoxdur.</p>
      <Link href="/dashboard" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        İdarə panelinə qayıt
      </Link>
    </div>
  );
}
