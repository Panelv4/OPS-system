import { AuthScreen } from "@/opspilot/components/Auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; token?: string }> }) {
  const params = await searchParams;
  const mode = params.mode;
  const token = typeof params.token === "string" ? params.token : undefined;
  const action = token && (mode === "verify" || mode === "reset" || mode === "invite")
    ? { kind: mode as "verify" | "reset" | "invite", token }
    : undefined;
  return <AuthScreen initialMode={mode === "register" ? "register" : "login"} action={action} />;
}
