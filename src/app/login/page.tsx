import { AuthScreen } from "@/opspilot/components/Auth";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) { const params = await searchParams; return <AuthScreen initialMode={params.mode === "register" ? "register" : "login"}/>; }
