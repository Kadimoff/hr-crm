"use client";

import { BriefcaseIcon, IdCardIcon, PhoneIcon, SaveIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { savePersonAction } from "@/actions/persons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PersonFormOptions } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NONE = "__none__";

interface Option {
  value: string;
  label: string;
  hint?: string;
}

const GENDER: Option[] = [
  { value: "MALE", label: "Kişi" },
  { value: "FEMALE", label: "Qadın" },
];
const MARITAL: Option[] = [
  { value: "SINGLE", label: "Subay" },
  { value: "MARRIED", label: "Evli" },
  { value: "DIVORCED", label: "Boşanmış" },
  { value: "WIDOWED", label: "Dul" },
];
const STATUS: Option[] = [
  { value: "ACTIVE", label: "Aktiv" },
  { value: "ON_LEAVE", label: "Məzuniyyətdə" },
  { value: "TERMINATED", label: "Azad olunub" },
];

/** Forma ilə göndərilən select: dəyər gizli input-da saxlanılır (Radix boş dəyəri qəbul etmir) */
function FormSelect({
  name,
  value,
  onChange,
  options,
  placeholder,
  optional,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder: string;
  optional?: boolean;
  invalid?: boolean;
}) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
        <SelectTrigger id={name} aria-invalid={invalid} className={cn("w-full", invalid && "border-danger")}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
          {optional && (
            <>
              <SelectItem value={NONE} className="text-muted-foreground">
                Seçilməyib
              </SelectItem>
              <SelectSeparator />
            </>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.hint && <span className="ml-2 text-xs text-muted-foreground">{o.hint}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: typeof UserIcon; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-2">
        <Icon className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</CardContent>
    </Card>
  );
}

export function PersonForm({ initial, options }: { initial?: Record<string, string>; options: PersonFormOptions }) {
  const [state, formAction, pending] = useActionState(savePersonAction, {});
  const editing = !!initial?.id;
  const v = (k: string) => initial?.[k] ?? "";
  const [selects, setSelects] = useState<Record<string, string>>({
    gender: v("gender"),
    maritalStatus: v("maritalStatus"),
    departmentId: v("departmentId"),
    positionId: v("positionId"),
    status: v("status") || "ACTIVE",
  });
  const set = (k: string) => (val: string) => {
    setSelects((s) => ({ ...s, [k]: val }));
    touch(k);
  };
  // Sahə dəyişən kimi onun xəta mesajı gizlənir; yeni göndərişdən sonra yenidən hesablanır
  const [touched, setTouched] = useState<Set<string>>(new Set());
  useEffect(() => setTouched(new Set()), [state]);
  const fe = Object.fromEntries(Object.entries(state.fieldErrors ?? {}).filter(([k]) => !touched.has(k)));
  const touch = (name: string) => setTouched((t) => (t.has(name) ? t : new Set(t).add(name)));

  // Forma React 19-un avtomatik sıfırlamasından qorunur — xəta olduqda daxil edilənlər itmir
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };

  const field = (name: string, label: string, props: React.ComponentProps<typeof Input> & { hint?: string; wide?: boolean } = {}) => {
    const { hint, wide, required, ...rest } = props;
    return (
      <FormField label={label} htmlFor={name} error={fe[name]} hint={hint} required={required} className={cn(wide && "sm:col-span-2")}>
        <Input id={name} name={name} defaultValue={v(name)} aria-invalid={!!fe[name]} className={cn(fe[name] && "border-danger")} {...rest} />
      </FormField>
    );
  };

  return (
    <form onSubmit={onSubmit} onChange={(e) => touch((e.target as unknown as HTMLInputElement).name)} className="flex flex-col gap-6" noValidate>
      {editing && <input type="hidden" name="id" value={v("id")} />}
      <input type="hidden" name="employmentId" value={v("employmentId")} />

      <Section icon={UserIcon} title="Şəxsi məlumatlar">
        {field("lastName", "Soyadı", { required: true, autoFocus: !editing })}
        {field("firstName", "Adı", { required: true })}
        {field("patronymic", "Atasının adı")}
        <FormField label="Cinsi" htmlFor="gender" error={fe.gender} required>
          <FormSelect name="gender" value={selects.gender!} onChange={set("gender")} options={GENDER} placeholder="Seçin" invalid={!!fe.gender} />
        </FormField>
        {field("birthDate", "Doğum tarixi", { type: "date", required: true })}
        <FormField label="Ailə vəziyyəti" htmlFor="maritalStatus" error={fe.maritalStatus}>
          <FormSelect name="maritalStatus" value={selects.maritalStatus!} onChange={set("maritalStatus")} options={MARITAL} placeholder="Seçilməyib" optional />
        </FormField>
        {field("code", "Əməkdaş kodu", { hint: editing ? undefined : "Boş qalsa avtomatik verilir (E006…)", className: "font-mono" })}
        {field("citizenship", "Vətəndaşlıq")}
      </Section>

      <Section icon={IdCardIcon} title="Şəxsiyyət sənədi">
        {field("fin", "FİN kod", { required: true, maxLength: 7, className: "font-mono uppercase", hint: "7 simvol, latın hərfləri və rəqəmlər" })}
        {field("idDocType", "Sənədin növü", { required: true, placeholder: "Şəxsiyyət vəsiqəsi", defaultValue: v("idDocType") || "Şəxsiyyət vəsiqəsi" })}
        {field("idDocSeries", "Seriya", { placeholder: "AZE" })}
        {field("idDocNumber", "Nömrə", { required: true })}
        {field("idDocIssueDate", "Verilmə tarixi", { type: "date" })}
        {field("idDocIssuedBy", "Kim tərəfindən verilib")}
        {field("ssn", "SSN (sosial sığorta)")}
      </Section>

      <Section icon={PhoneIcon} title="Əlaqə">
        {field("mobilePhone", "Mobil telefon", { type: "tel", placeholder: "+994 50 000 00 00" })}
        {field("workPhone", "Xidməti telefon", { type: "tel" })}
        {field("email", "E-poçt", { type: "email" })}
        {field("registeredAddress", "Qeydiyyat ünvanı", { wide: true })}
        {field("livingAddress", "Faktiki ünvan")}
      </Section>

      <Section icon={BriefcaseIcon} title="Əsas iş yeri" description="Boş saxlanıla bilər — müqavilə sonra əlavə olunar. Oklad dəyişəndə tarixçə avtomatik saxlanılır.">
        <FormField label="Struktur bölmə" htmlFor="departmentId" error={fe.departmentId} className="sm:col-span-2 lg:col-span-1">
          <FormSelect name="departmentId" value={selects.departmentId!} onChange={set("departmentId")} options={options.departments} placeholder="Seçin" optional invalid={!!fe.departmentId} />
        </FormField>
        <FormField label="Vəzifə" htmlFor="positionId" error={fe.positionId}>
          <FormSelect name="positionId" value={selects.positionId!} onChange={set("positionId")} options={options.positions} placeholder="Seçin" optional invalid={!!fe.positionId} />
        </FormField>
        {field("hireDate", "İşə qəbul tarixi", { type: "date" })}
        {field("baseSalary", "Oklad (₼)", { type: "number", inputMode: "decimal", step: "0.01", min: 0, className: "tabular-nums" })}
        {field("unitShare", "Ştat vahidi", { type: "number", inputMode: "decimal", step: "0.25", min: 0.25, max: 2, placeholder: "1" })}
        <FormField label="Status" htmlFor="status" error={fe.status}>
          <FormSelect name="status" value={selects.status!} onChange={set("status")} options={STATUS} placeholder="Aktiv" />
        </FormField>
        {field("schedule", "İş rejimi", { placeholder: "5 günlük iş həftəsi" })}
        {field("paymentForm", "Ödəniş forması", { placeholder: "Aylıq oklad" })}
        {selects.status === "TERMINATED" && (
          <>
            {field("terminationDate", "Azad olunma tarixi", { type: "date", required: true })}
            {field("terminationArticle", "ƏM maddəsi", { placeholder: "68.1" })}
          </>
        )}
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t bg-background/90 px-4 py-3 backdrop-blur-md sm:flex-row sm:items-center md:-mx-8 md:px-8">
        {state.error ? <p className="text-sm text-danger">{state.error}</p> : <p className="text-xs text-muted-foreground">* — məcburi sahələr</p>}
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" asChild className="flex-1 sm:flex-none">
            <Link href={editing ? `/employees/${v("id")}` : "/employees"}>Ləğv et</Link>
          </Button>
          <Button type="submit" disabled={pending} className="flex-1 sm:flex-none">
            <SaveIcon /> {pending ? "Saxlanılır…" : editing ? "Dəyişiklikləri saxla" : "Əməkdaşı əlavə et"}
          </Button>
        </div>
      </div>
    </form>
  );
}
