import { z } from "zod";

const DEMO_PRINCIPAL_HEADER = "x-demo-principal";
const DEFAULT_LOCAL_PRINCIPAL = "local-user";

const principalSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9:_-]+$/);

export type DemoAccessResult =
  | { ok: true; principal: string }
  | { ok: false; status: 401 | 503; error: string };

export function normalizeDemoPrincipal(value: string | null | undefined): string | null {
  const parsed = principalSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function getDefaultLocalPrincipal(): string {
  return DEFAULT_LOCAL_PRINCIPAL;
}

export function requireDemoPrincipal(request: Request): DemoAccessResult {
  const principal =
    normalizeDemoPrincipal(request.headers.get(DEMO_PRINCIPAL_HEADER)) ??
    getDefaultLocalPrincipal();
  return { ok: true, principal };
}
