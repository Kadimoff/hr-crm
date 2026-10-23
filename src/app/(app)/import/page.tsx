import { DownloadIcon } from "lucide-react";
import { Suspense } from "react";
import { UploadWizard } from "@/components/import/upload-wizard";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TEMPLATES } from "@/lib/validation/templates";

export const metadata = { title: "İdxal mərkəzi" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="İdxal mərkəzi"
        description="10 şablonu bir dəfəyə yükləyin — sistem onları asılılıq ardıcıllığı ilə yoxlayır, xətaları brauzerdə düzəltməyə imkan verir və bazaya yazır"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <DownloadIcon /> Boş şablonlar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {Object.values(TEMPLATES).map((t) => (
                <DropdownMenuItem key={t.key} asChild>
                  <a href={`/api/templates/${t.key}`} download>
                    <span className="w-5 font-mono text-xs text-muted-foreground">{t.number}</span>
                    {t.title}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <Suspense>
        <UploadWizard />
      </Suspense>
    </>
  );
}
