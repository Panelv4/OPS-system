"use client";
import { useId, useState } from "react";
import type { BusinessRecord } from "../lib/types";
import { compactMoney, money } from "../lib/client";
export function cashFlow(records: BusinessRecord[], month: number, year: number) {
  const now = new Date(); const days = now.getMonth() === month && now.getFullYear() === year ? now.getDate() : new Date(year, month + 1, 0).getDate();
  const points = Array.from({ length: 7 }, (_, i) => ({ day: Math.max(1, Math.ceil((i + 1) * days / 7)), revenue: 0, expenses: 0 }));
  for (const r of records) {
    if (r.kind === "invoices") for (const p of r.payments ?? []) { const d = new Date(p.createdAt); if (d.getMonth() === month && d.getFullYear() === year) { const i = Math.min(6, Math.floor((d.getDate() - 1) / Math.max(days, 1) * 7)); points[i].revenue += p.amountCents; } }
    if (r.kind === "expenses") { const d = new Date(r.createdAt); if (d.getMonth() === month && d.getFullYear() === year) { const i = Math.min(6, Math.floor((d.getDate() - 1) / Math.max(days, 1) * 7)); points[i].expenses += r.amountCents; } }
  }
  return points;
}
function pathFor(points: { x: number; y: number }[]) { return points.map((p, i) => { if (!i) return `M ${p.x} ${p.y}`; const prev = points[i - 1]; const mid = (prev.x + p.x) / 2; return `C ${mid} ${prev.y}, ${mid} ${p.y}, ${p.x} ${p.y}`; }).join(" "); }
export function Sparkline({ values, color = "#248b74" }: { values: number[]; color?: string }) {
  const id = useId().replaceAll(":", ""); const min = Math.min(...values, 0); const max = Math.max(...values, 1); const points = values.map((v, i) => ({ x: i * 86 / Math.max(values.length - 1, 1), y: 27 - (v - min) / Math.max(max - min, 1) * 23 })); const path = pathFor(points);
  return <svg className="sparkline" viewBox="0 0 88 34" aria-hidden="true"><defs><linearGradient id={`spark${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".16"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs><path d={`${path} L 86 34 L 0 34 Z`} fill={`url(#spark${id})`}/><path d={path} stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg>;
}
export function RevenueChart({ records, month, year }: { records: BusinessRecord[]; month: number; year: number }) {
  const points = cashFlow(records, month, year); const [active, setActive] = useState<number | null>(null); const id = useId().replaceAll(":", "");
  const max = Math.ceil(Math.max(...points.map(p => Math.max(p.revenue, p.expenses)), 1000000) / 1000000) * 1000000;
  const width = 680; const height = 214; const left = 52; const right = 15; const top = 14; const bottom = 32; const chartWidth = width - left - right; const chartHeight = height - top - bottom;
  const coordinates = (key: "revenue" | "expenses") => points.map((p, i) => ({ x: left + i * chartWidth / 6, y: top + chartHeight * (1 - p[key] / max) }));
  const revenue = coordinates("revenue"); const expenses = coordinates("expenses"); const monthLabel = new Date(year, month).toLocaleDateString("en-US", { month: "short" });
  return <div className="revenue-chart" onMouseLeave={() => setActive(null)}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Revenue and expense trends for ${monthLabel}. Revenue ${money(points.reduce((s, p) => s + p.revenue, 0))}; expenses ${money(points.reduce((s, p) => s + p.expenses, 0))}.`} onMouseMove={e => { const box = e.currentTarget.getBoundingClientRect(); setActive(Math.max(0, Math.min(6, Math.round(((e.clientX - box.left) / box.width * width - left) / chartWidth * 6)))); }}>
    <defs><linearGradient id={`revenue${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#389a82" stopOpacity=".16"/><stop offset="100%" stopColor="#389a82" stopOpacity=".015"/></linearGradient><linearGradient id={`expense${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b0a4e6" stopOpacity=".13"/><stop offset="100%" stopColor="#b0a4e6" stopOpacity="0"/></linearGradient></defs>
    {[0, 1, 2, 3, 4].map(i => { const y = top + i * chartHeight / 4; return <g key={i}><line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--chart-grid)" strokeDasharray="3 4"/><text x={left - 12} y={y + 4} textAnchor="end" className="chart-label">{compactMoney(max * (1 - i / 4))}</text></g>; })}
    <path d={`${pathFor(expenses)} L ${width - right} ${height - bottom} L ${left} ${height - bottom} Z`} fill={`url(#expense${id})`}/><path d={`${pathFor(revenue)} L ${width - right} ${height - bottom} L ${left} ${height - bottom} Z`} fill={`url(#revenue${id})`}/>
    <path d={pathFor(expenses)} fill="none" stroke="#b7a6df" strokeWidth="2.3" strokeLinecap="round"/><path d={pathFor(revenue)} fill="none" stroke="#368d76" strokeWidth="2.7" strokeLinecap="round"/>
    {points.map((p, i) => <text key={i} x={left + i * chartWidth / 6} y={height - 7} textAnchor="middle" className="chart-label">{monthLabel} {p.day}</text>)}
    {active !== null && <g><line x1={revenue[active].x} x2={revenue[active].x} y1={top} y2={height - bottom} stroke="#71a693" strokeDasharray="4 4"/><circle cx={revenue[active].x} cy={revenue[active].y} r="4.5" fill="#32866e" stroke="var(--surface)" strokeWidth="2"/><circle cx={expenses[active].x} cy={expenses[active].y} r="4" fill="#b7a6df" stroke="var(--surface)" strokeWidth="2"/></g>}
  </svg>{active !== null && <div className="chart-tooltip" style={{ left: `${Math.min(76, Math.max(8, active / 6 * 83))}%` }}><b>Through {monthLabel} {points[active].day}</b><span><i className="legend-dot green"/> Revenue <strong>{money(points[active].revenue)}</strong></span><span><i className="legend-dot purple"/> Expenses <strong>{money(points[active].expenses)}</strong></span></div>}</div>;
}
export function ExpenseBreakdown({ records }: { records: BusinessRecord[] }) {
  const map = new Map<string, number>(); const now = new Date();
  for (const r of records.filter(r => r.kind === "expenses" && new Date(r.createdAt).getMonth() === now.getMonth() && new Date(r.createdAt).getFullYear() === now.getFullYear())) map.set(r.category || "Other", (map.get(r.category || "Other") ?? 0) + r.amountCents);
  const entries = [...map].sort((a, b) => b[1] - a[1]); const total = entries.reduce((s, p) => s + p[1], 0); const colors = ["#418b77", "#8fb9aa", "#af9cda", "#d3c6e8", "#dfb475", "#bac2cc"];
  return <div className="expense-breakdown"><div className="donut-wrap"><svg viewBox="0 0 160 160" aria-label={`Recorded expenses ${money(total)}`} role="img"><circle cx="80" cy="80" r="61" stroke="var(--surface-subtle)" strokeWidth="18" fill="none"/>{entries.map(([name, value], i) => { const size = total ? value / total * 383.27 : 0; const previous = entries.slice(0, i).reduce((sum, entry) => sum + (total ? entry[1] / total * 383.27 : 0), 0); return <circle key={name} cx="80" cy="80" r="61" stroke={colors[i % colors.length]} strokeWidth="18" fill="none" strokeDasharray={`${Math.max(0, size - 3)} ${383.27 - size + 3}`} strokeDashoffset={-previous} transform="rotate(-90 80 80)"/>; })}</svg><div className="donut-label"><span>Total expenses</span><strong>{compactMoney(total)}</strong></div></div><div className="expense-legend">{entries.map(([name, value], i) => <div key={name}><span><i style={{ background: colors[i % colors.length] }}/>{name}</span><b>{money(value)}</b></div>)}</div></div>;
}
