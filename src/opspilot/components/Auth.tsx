"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Layers3, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { api } from "../lib/client";
import { Brand, Button, Modal } from "./UI";
import { Field } from "./RecordForms";
type EmailAction = { kind: "verify" | "reset" | "invite"; token: string };
export function AuthScreen({ initialMode = "login", action }: { initialMode?: "login" | "register"; action?: EmailAction }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [recovery, setRecovery] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const fields = new FormData(e.currentTarget); setBusy(true); setError(""); try { await api(`/api/session/${mode}`, "POST", { email: fields.get("email"), password: fields.get("password"), ...(mode === "register" ? { name: fields.get("name"), workspace: fields.get("workspace") } : {}) }); router.replace("/"); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to continue."); } finally { setBusy(false); } }
  if (action) return <EmailActionScreen action={action}/>;
  async function demo() { setBusy(true); setError(""); try { await api("/api/session/demo", "POST", {}); router.replace("/"); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to open the demo."); setBusy(false); } }
  return <div className="auth-page"><section className="auth-form-side"><a href="/welcome" className="auth-brand"><Brand/></a><div className="auth-form-wrap"><div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div><h1>{mode === "login" ? "Welcome back." : "Room for your big ideas."}</h1><p>{mode === "login" ? "A little less busywork. A little more possibility." : "Your business, beautifully connected. Let’s get started."}</p><form className="auth-form" onSubmit={submit}>{mode === "register" && <><Field label="Your full name"><input name="name" autoComplete="name" placeholder="Alex Morgan" required minLength={2} maxLength={120}/></Field><Field label="Workspace name"><input name="workspace" autoComplete="organization" placeholder="Your company or team" required minLength={2} maxLength={120}/></Field></>}<Field label="Email address"><input type="email" name="email" autoComplete="email" placeholder="you@company.com" required maxLength={254}/></Field><Field label="Password" hint={mode === "register" ? "At least 10 characters. Make it a good one." : undefined}><div className="password-input"><input type={show ? "text" : "password"} name="password" autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "login" ? "Your password" : "Create a strong password"} required minLength={10} maxLength={128}/><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></Field>{mode === "login" && <button className="recovery-link" type="button" onClick={() => setRecovery(true)}>Need help signing in?</button>}{error && <div className="form-error" role="alert">{error}</div>}<Button type="submit" className="auth-submit" busy={busy}>{mode === "login" ? "Sign in to your workspace" : "Create your workspace"}<ArrowRight size={16}/></Button><div className="auth-security"><LockKeyhole size={12}/>{mode === "register" ? "A private workspace. No credit card required." : "Your business data stays in your workspace."}</div></form><div className="auth-divider"><span/>or take a look around<span/></div><Button variant="secondary" className="auth-demo" onClick={() => void demo()} disabled={busy}><Sparkles size={16}/>Explore a private demo<ArrowUpRightIcon/></Button><p className="auth-switch">{mode === "login" ? "New to OpsPilot?" : "Already have a workspace?"} <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create a workspace" : "Sign in"}</button></p></div><footer className="auth-footer"><a href="/welcome"><ArrowLeft size={13}/>Back to OpsPilot</a><span>A clearer way to work.</span></footer></section><aside className="auth-story"><div className="auth-story-grid"/><div className="auth-story-content"><span className="story-label"><span/>EVERYTHING, WORKING TOGETHER</span><h2>Your entire business.<br/>One operating system.<br/><em>A little more possibility.</em></h2><p>Less switching tabs. More moving forward.<br/>Meet the workspace that puts it all in perspective.</p><div className="auth-feature-cards"><div><span className="auth-feature-icon"><Layers3 size={22}/></span><div><strong>One beautifully connected workspace</strong><p>Customers. Finances. Projects. People.</p></div><Check size={17}/></div><div><span className="auth-feature-icon"><TrendingUp size={22}/></span><div><strong>Clarity behind every decision</strong><p>Live data. A clear picture. Your next move.</p></div><Check size={17}/></div><div><span className="auth-feature-icon"><Sparkles size={22}/></span><div><strong>A little intelligence on your side</strong><p>Turn your questions into a way forward.</p></div><Check size={17}/></div></div><div className="story-bottom"><span className="story-spark">✦</span><p>Good work starts with a little clarity.<br/><strong>Let’s make room for yours.</strong></p></div></div></aside>{recovery && <RecoveryModal onClose={() => setRecovery(false)}/>}</div>;
}
function ArrowUpRightIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>; }


function RecoveryModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false); const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const email = new FormData(e.currentTarget).get("email"); setBusy(true); setError("");
    try { await api("/api/session/request-reset", "POST", { email }); setSent(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to send a reset link."); }
    finally { setBusy(false); }
  }
  return <Modal title="Let’s get you back in" subtitle="We’ll email you a single-use link." onClose={onClose}>
    {sent ? <div className="help-content"><div className="settings-notice"><ShieldCheck size={22}/><p>If that address has an account, a reset link is on its way. It expires in 30 minutes and can be used once. Check your spam folder if it does not arrive within a few minutes.</p></div></div>
      : <form className="auth-form" onSubmit={submit}><Field label="Email address"><input type="email" name="email" autoComplete="email" placeholder="you@company.com" required maxLength={254}/></Field>{error && <div className="form-error" role="alert">{error}</div>}<p className="auth-security" style={{ marginTop: 0 }}><LockKeyhole size={12}/>For privacy we always give the same answer, whether or not an account exists.</p><Button type="submit" busy={busy} className="auth-submit">Email me a reset link<ArrowRight size={16}/></Button></form>}
    <footer className="modal-footer"><Button variant="secondary" onClick={onClose}>Close</Button></footer>
  </Modal>;
}

/** Handles the three email links: confirm address, choose a new password, accept an invitation. */
function EmailActionScreen({ action }: { action: EmailAction }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"busy" | "idle" | "done" | "error">(action.kind === "verify" ? "busy" : "idle");
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (action.kind !== "verify") return;
    let cancelled = false;
    void (async () => {
      try {
        await api("/api/session/verify", "POST", { token: action.token });
        if (!cancelled) { setMessage("Your email address is confirmed. Everything is ready."); setPhase("done"); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : "This link could not be used."); setPhase("error"); }
      }
    })();
    return () => { cancelled = true; };
  }, [action.kind, action.token]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fields = new FormData(e.currentTarget); setBusy(true); setError("");
    try {
      if (action.kind === "reset") {
        await api("/api/session/reset", "POST", { token: action.token, password: fields.get("password") });
        setMessage("Password updated. Every other session has been signed out.");
        setPhase("done");
      } else {
        await api("/api/members/accept", "POST", { token: action.token, name: fields.get("name"), password: fields.get("password") });
        router.replace("/"); router.refresh();
        return;
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to continue."); }
    finally { setBusy(false); }
  }

  const heading = action.kind === "verify" ? "Confirming your email." : action.kind === "reset" ? "Choose a new password." : "Join your team on OpsPilot.";
  const sub = action.kind === "verify" ? "One moment while we check that link." : action.kind === "reset" ? "Pick something at least 10 characters long." : "Set up your sign-in for this workspace.";

  return <div className="auth-page"><section className="auth-form-side"><a href="/welcome" className="auth-brand"><Brand/></a><div className="auth-form-wrap">
    <div className="eyebrow">ACCOUNT ACCESS</div><h1>{heading}</h1><p>{sub}</p>
    {phase === "error" && <div className="form-error" role="alert">{error}</div>}
    {phase === "done" ? <div className="auth-form"><div className="settings-notice"><ShieldCheck size={22}/><p>{message}</p></div><Button className="auth-submit" onClick={() => router.replace(action.kind === "verify" ? "/" : "/login")}>{action.kind === "verify" ? "Go to your workspace" : "Sign in"}<ArrowRight size={16}/></Button></div>
      : phase === "busy" ? <div className="auth-form"><p className="auth-security"><LoaderCircle size={14} className="spin"/>Checking your link…</p></div>
        : <form className="auth-form" onSubmit={submit}>
          {action.kind === "invite" && <Field label="Your full name"><input name="name" autoComplete="name" placeholder="Alex Morgan" required minLength={2} maxLength={120}/></Field>}
          <Field label={action.kind === "reset" ? "New password" : "Password"} hint="At least 10 characters."><input type="password" name="password" autoComplete="new-password" placeholder="Create a strong password" required minLength={10} maxLength={128}/></Field>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button type="submit" busy={busy} className="auth-submit">{action.kind === "reset" ? "Save new password" : "Accept invitation"}<ArrowRight size={16}/></Button>
        </form>}
    <p className="auth-switch"><a href="/login">Back to sign in</a></p>
  </div><footer className="auth-footer"><a href="/welcome"><ArrowLeft size={13}/>Back to OpsPilot</a><span>A clearer way to work.</span></footer></section><aside className="auth-story"><div className="auth-story-grid"/><div className="auth-story-content"><span className="story-label"><span/>EVERYTHING, WORKING TOGETHER</span><h2>Your entire business.<br/>One operating system.<br/><em>A little more possibility.</em></h2><p>Less switching tabs. More moving forward.</p></div></aside></div>;
}
