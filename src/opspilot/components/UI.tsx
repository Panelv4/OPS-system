"use client";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, ArrowUpRight, LoaderCircle, Check } from "lucide-react";
import { initials } from "../lib/client";
export function Brand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return <span className={`brand ${light ? "brand-light" : ""}`}><span className="brand-symbol"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 22.5 16 9l3.8 6.3L16 22.5H8Z" fill="currentColor"/><path d="M17 9h7L16 22.5h-7L17 9Z" fill="currentColor" opacity=".45"/><path d="m23.2 9 3.3 5.5-4.7 8h-6.5L23.2 9Z" fill="currentColor" opacity=".8"/></svg></span>{!compact && <span>OpsPilot<span className="brand-dot">.</span></span>}</span>;
}
export function Button({ children, variant = "primary", className = "", busy, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean }) {
  return <button className={`btn btn-${variant} ${className}`} {...props} disabled={props.disabled || busy}>{busy && <LoaderCircle size={15} className="spin"/>}{children}</button>;
}
export function IconButton({ children, label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}
export function Avatar({ name, size = "md", color, className = "" }: { name: string; size?: "xs" | "sm" | "md" | "lg"; color?: number; className?: string }) {
  const index = color ?? Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  return <span className={`avatar avatar-${size} avatar-color-${index} ${className}`} title={name}>{initials(name)}</span>;
}
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const text = typeof children === "string" ? children : "";
  const auto = ["Paid", "Active", "Done", "Completed", "Available", "Won", "Recorded"].includes(text) ? "green" : ["Overdue", "High", "Lost"].includes(text) ? "red" : ["Unpaid", "Partial", "Medium", "On leave", "Negotiation"].includes(text) ? "amber" : ["In progress", "Qualified", "Proposal"].includes(text) ? "blue" : "neutral";
  return <span className={`badge badge-${tone ?? auto}`}><span className="badge-dot"/>{children}</span>;
}
export function Modal({ title, subtitle, children, onClose, wide = false, className = "" }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null); const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement; const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => (ref.current?.querySelector<HTMLElement>("input,textarea,select") ?? ref.current?.querySelector<HTMLElement>("button"))?.focus(), 50);
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") { const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex="0"]') ?? []).filter(el => el.offsetParent !== null); const first = elements[0]; const last = elements[elements.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    }
    document.addEventListener("keydown", keydown);
    return () => { clearTimeout(timer); document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={`modal ${wide ? "modal-wide" : ""} ${className}`}><header className="modal-header"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={20}/></IconButton></header>{children}</section></div>, document.body);
}
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon ?? <ArrowUpRight size={26}/>}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={`custom-checkbox ${checked ? "checked" : ""}`} onClick={onChange}>{checked && <Check size={12}/>}</button>;
}
