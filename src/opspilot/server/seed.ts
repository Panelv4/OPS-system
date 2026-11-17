import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { workspaces, users, memberships, records, payments, stockMovements, notifications, auditEvents } from "@/db/schema";
import { hashPassword } from "./security";

export async function createDemoWorkspace() {
  const passwordHash = await hashPassword(randomUUID());
  return db.transaction(async tx => {
    const [workspace] = await tx.insert(workspaces).values({ name: "Acme Inc.", isDemo: true, settings: { currency: "USD", widgets: ["insights", "metrics", "charts", "quickActions", "tasks", "activity"] } }).returning();
    const [user] = await tx.insert(users).values({ name: "Alex Morgan", email: `demo-${randomUUID()}@opspilot.local`, passwordHash }).returning();
    await tx.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
    const now = new Date(); const year = now.getFullYear(); const month = now.getMonth(); const day = Math.max(now.getDate(), 1);
    const date = (d: number, offset = 0) => new Date(year, month + offset, offset === 0 ? Math.max(1, Math.min(d, day)) : d, 9, 30);
    const dateString = (delta: number) => { const d = new Date(now); d.setDate(d.getDate() + delta); return d.toISOString().slice(0, 10); };
    const wid = workspace.id;
    const contactNames = ["Linear Studio", "Notion Labs", "Vercel Inc.", "Luma Creative", "Figma", "Arc & Co.", "Northstar Digital", "Bloom Agency"];
    await tx.insert(records).values(contactNames.map((name, i) => ({ workspaceId: wid, kind: "customers", name, subtitle: ["Olivia Rhye", "Phoenix Baker", "Lana Steiner", "Demi Wilkinson", "Drew Cano", "Natali Craig", "Orlando Diggs", "Kate Morrison"][i], email: `hello@${name.toLowerCase().replace(/[^a-z]/g, "")}.example`, category: i % 2 ? "Enterprise" : "Small business", status: "Active", owner: "Alex Morgan", createdAt: date(i + 1) })));
    const paidAmounts = [18400, 12600, 24000, 9600, 16800, 14250, 32800];
    for (let i = 0; i < paidAmounts.length; i++) {
      const createdAt = date(Math.ceil((i + 1) * day / 7));
      const [r] = await tx.insert(records).values({ workspaceId: wid, kind: "invoices", name: `INV-${year}-${String(i + 1).padStart(3, "0")}`, subtitle: contactNames[i], amountCents: paidAmounts[i] * 100, status: "Paid", dueDate: dateString(-i), category: "Services", createdAt, details: { description: ["Brand identity & website", "Product design retainer", "Platform development", "Growth consulting", "Design partnership", "Strategy & discovery", "Digital transformation"][i], lines: [{ description: "Professional services", quantity: 1, unitCents: paidAmounts[i] * 100 }] } }).returning();
      await tx.insert(payments).values({ workspaceId: wid, recordId: r.id, amountCents: paidAmounts[i] * 100, createdAt });
    }
    for (const [i, amount] of [4800, 3200, 6500, 1800, 2400, 6100].entries()) {
      await tx.insert(records).values({ workspaceId: wid, kind: "invoices", name: `INV-${year}-${String(i + 8).padStart(3, "0")}`, subtitle: contactNames[i], amountCents: amount * 100, status: i < 2 ? "Overdue" : "Unpaid", dueDate: dateString(i < 2 ? -5 + i : i + 2), category: "Services", createdAt: date(Math.max(1, day - i)), details: { description: "Monthly service retainer", lines: [{ description: "Monthly service retainer", quantity: 1, unitCents: amount * 100 }] } });
    }
    const [previous] = await tx.insert(records).values({ workspaceId: wid, kind: "invoices", name: `INV-${year}-PREV`, subtitle: "Previous month retainers", amountCents: 11387500, status: "Paid", createdAt: date(15, -1) }).returning();
    await tx.insert(payments).values({ workspaceId: wid, recordId: previous.id, amountCents: 11387500, createdAt: date(15, -1) });
    const expenseNames = ["Team payroll", "Software subscriptions", "Office & workspace", "Marketing campaign", "Cloud infrastructure", "Team offsite", "Professional services", "Equipment & supplies"];
    const expenseCategories = ["Payroll", "Software", "Office", "Marketing", "Software", "Travel", "Services", "Office"];
    await tx.insert(records).values([16000, 8400, 6250, 3500, 2300, 1680, 1950, 2600].map((amount, i) => ({ workspaceId: wid, kind: "expenses", name: expenseNames[i], subtitle: ["Monthly salaries", "Figma, Notion & Linear", "WeWork Downtown", "Google Ads", "AWS", "Quarterly retreat", "Accounting services", "Workspace essentials"][i], amountCents: amount * 100, status: "Recorded", category: expenseCategories[i], createdAt: date(Math.ceil((i + 1) * day / 8)) })));
    await tx.insert(records).values({ workspaceId: wid, kind: "expenses", name: "Previous month operating expenses", amountCents: 3944500, status: "Recorded", category: "Operations", createdAt: date(15, -1) });
    const leadSeeds = [
      ["Orbit Digital", "New", 8500], ["Aether Studio", "New", 6000], ["Forma Design", "New", 4000],
      ["Evergreen Co.", "Qualified", 12500], ["Summit Health", "Qualified", 7500],
      ["Nova Technologies", "Proposal", 15000], ["Atlas Ventures", "Proposal", 10000],
      ["Mosaic Group", "Negotiation", 18000], ["Craft & Commerce", "Won", 12000],
    ] as const;
    await tx.insert(records).values(leadSeeds.map(([name, status, amount], i) => ({ workspaceId: wid, kind: "leads", name, status, subtitle: "New business opportunity", amountCents: amount * 100, category: ["Referral", "Website", "LinkedIn"][i % 3], owner: i % 2 ? "Sarah Chen" : "Alex Morgan", dueDate: dateString(i - 2), details: { priority: i % 3 === 0 ? "High" : "Medium" }, createdAt: date(i + 1) })));
    await tx.insert(records).values([
      { name: "Website redesign", subtitle: "Linear Studio", amountCents: 2400000, status: "In progress", owner: "Alex Morgan", category: "Design", dueDate: dateString(12), details: { progress: 72, color: "purple" } },
      { name: "Brand identity", subtitle: "Bloom Agency", amountCents: 850000, status: "In progress", owner: "Sarah Chen", category: "Branding", dueDate: dateString(6), details: { progress: 48, color: "orange" } },
      { name: "Customer portal", subtitle: "Northstar Digital", amountCents: 3280000, status: "In progress", owner: "James Wilson", category: "Development", dueDate: dateString(24), details: { progress: 35, color: "blue" } },
      { name: "Q3 growth strategy", subtitle: "Acme Inc.", amountCents: 1500000, status: "Planning", owner: "Alex Morgan", category: "Strategy", dueDate: dateString(30), details: { progress: 10, color: "green" } },
    ].map(r => ({ ...r, workspaceId: wid, kind: "projects" })));
    await tx.insert(records).values([
      { name: "Review homepage designs", subtitle: "Website redesign", owner: "Alex Morgan", category: "High", status: "To do" },
      { name: "Send proposal to Nova Technologies", subtitle: "Sales & CRM", owner: "Sarah Chen", category: "High", status: "To do" },
      { name: "Approve this month’s expenses", subtitle: "Finance", owner: "Alex Morgan", category: "Medium", status: "In progress" },
      { name: "Prepare project kickoff deck", subtitle: "Customer portal", owner: "James Wilson", category: "Medium", status: "To do" },
      { name: "Update brand guidelines", subtitle: "Brand identity", owner: "Lana Steiner", category: "Low", status: "To do" },
      { name: "Publish team onboarding guide", subtitle: "People & culture", owner: "Sarah Chen", category: "Low", status: "Done" },
    ].map((r, i) => ({ ...r, workspaceId: wid, kind: "tasks", dueDate: dateString(i < 4 ? 0 : 2), details: { priority: r.category }, createdAt: date(Math.max(1, day - i)) })));
    const employeeNames = ["Alex Morgan", "Sarah Chen", "James Wilson", "Lana Steiner", "Olivia Rhye", "Phoenix Baker", "Demi Wilkinson", "Drew Cano"];
    await tx.insert(records).values(employeeNames.map((name, i) => ({ workspaceId: wid, kind: "employees", name, subtitle: ["Founder & CEO", "Head of Sales", "Senior Developer", "Product Designer", "People Manager", "Frontend Developer", "Marketing Lead", "Finance Manager"][i], email: `${name.split(" ")[0].toLowerCase()}@acme.example`, category: ["Leadership", "Sales", "Engineering", "Design", "People", "Engineering", "Marketing", "Finance"][i], status: i === 5 ? "On leave" : "Active", owner: "Alex Morgan", createdAt: date(1, -3) })));
    for (const [i, name] of ["Studio headphones", "Wireless keyboard", "USB-C hub", "4K monitor", "Desk essentials kit", "Ergonomic mouse"].entries()) {
      const quantity = [24, 8, 5, 18, 42, 32][i];
      const [product] = await tx.insert(records).values({ workspaceId: wid, kind: "products", name, subtitle: `ACM-${String(i + 1).padStart(4, "0")}`, category: ["Audio", "Accessories", "Accessories", "Displays", "Office", "Accessories"][i], amountCents: [14900, 8900, 4900, 39900, 3900, 6900][i], quantity, status: "Active", details: { reorderPoint: 10 } }).returning();
      await tx.insert(stockMovements).values({ workspaceId: wid, recordId: product.id, delta: quantity, reason: "Opening stock — demo fixture" });
    }
    await tx.insert(records).values(["TechSupply Co.", "WeWork", "CloudNine Hosting", "Paper & Pine"].map((name, i) => ({ workspaceId: wid, kind: "vendors", name, subtitle: ["Technology & equipment", "Workspace partner", "Cloud infrastructure", "Office supplies"][i], category: ["Equipment", "Office", "Software", "Supplies"][i], email: `accounts@vendor${i + 1}.example`, status: "Active" })));
    await tx.insert(records).values([
      { workspaceId: wid, kind: "workflows", name: "Welcome new leads", subtitle: "Keep every opportunity moving forward.", status: "Active", category: "CRM", details: { trigger: "lead.created", action: "notification", runs: 0 } },
      { workspaceId: wid, kind: "workflows", name: "Low-stock heads-up", subtitle: "Get notified before your shelves run empty.", status: "Active", category: "Inventory", details: { trigger: "stock.low", action: "notification", runs: 0 } },
      { workspaceId: wid, kind: "workflows", name: "New task notification", subtitle: "Make sure your team stays in the loop.", status: "Draft", category: "Projects", details: { trigger: "task.created", action: "notification", runs: 0 } },
    ]);
    await tx.insert(notifications).values([
      { workspaceId: wid, title: "Two invoices need a little nudge", message: "You have $8,000 in overdue invoices. Review your receivables to follow up.", module: "sales" },
      { workspaceId: wid, title: "Time to restock", message: "Wireless keyboard and USB-C hub are below their reorder points.", module: "inventory" },
      { workspaceId: wid, title: "Your focus for today", message: "Four tasks are due today. Take a look at your priority list.", module: "projects" },
      { workspaceId: wid, title: "Welcome to your workspace", message: "This is your private demo workspace. Explore, add records, and make it your own.", module: "overview" },
    ]);
    const events = [
      { actor: "Alex Morgan", action: "payment.received", subject: "Northstar Digital", metadata: { kind: "invoices", amountCents: 3280000 } },
      { actor: "Sarah Chen", action: "lead.created", subject: "Orbit Digital", metadata: { kind: "leads" } },
      { actor: "Lana Steiner", action: "task.completed", subject: "Publish team onboarding guide", metadata: { kind: "tasks" } },
      { actor: "Alex Morgan", action: "invoice.created", subject: `INV-${year}-013`, metadata: { kind: "invoices", amountCents: 610000 } },
      { actor: "James Wilson", action: "project.updated", subject: "Customer portal", metadata: { kind: "projects" } },
    ];
    await tx.insert(auditEvents).values(events.map((e, i) => ({ ...e, workspaceId: wid, createdAt: new Date(now.getTime() - (i * 29 + 8) * 60000) })));
    return { workspace, user, role: "owner" as const };
  });
}
