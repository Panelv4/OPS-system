export const kinds = ["customers", "leads", "invoices", "expenses", "employees", "projects", "tasks", "products", "vendors", "documents", "workflows"] as const;
export type RecordKind = typeof kinds[number];
export type View = "overview" | "inbox" | "crm" | "sales" | "finance" | "team" | "inventory" | "projects" | "vendors" | "documents" | "intelligence" | "automations" | "analytics" | "settings";
export type Role = "owner" | "administrator" | "manager" | "hr_manager" | "accountant" | "salesperson" | "employee";
export interface BusinessRecord {
  id: string; kind: RecordKind; name: string; subtitle: string; status: string; category: string;
  email: string; owner: string; amountCents: number; quantity: number; dueDate: string | null;
  details: Record<string, unknown>; createdAt: string; paidCents?: number; payments?: { amountCents: number; createdAt: string }[];
}
export interface Activity { id: string; actor: string; action: string; subject: string; createdAt: string; metadata: Record<string, unknown> }
export interface Notification { id: string; title: string; message: string; module: View; read: boolean; createdAt: string }
export interface WorkspaceData {
  workspace: { id: string; name: string; isDemo: boolean; settings: Record<string, unknown> };
  user: { id: string; name: string; email: string; role: Role };
  records: BusinessRecord[]; activities: Activity[]; notifications: Notification[];
  permissions: RecordKind[];
}
export const moduleTitles: Record<View, string> = {
  overview: "Overview", inbox: "Inbox", crm: "CRM & Customers", sales: "Sales & Invoices", finance: "Finance & Expenses",
  team: "HR & Team", inventory: "Inventory", projects: "Projects & Tasks", vendors: "Vendors", documents: "Documents",
  intelligence: "OpsPilot Intelligence", automations: "Automations", analytics: "Analytics & Reports", settings: "Settings",
};
export const kindLabels: Record<RecordKind, string> = {
  customers: "customer", leads: "lead", invoices: "invoice", expenses: "expense", employees: "employee", projects: "project",
  tasks: "task", products: "product", vendors: "vendor", documents: "document", workflows: "workflow",
};
export const kindViews: Record<RecordKind, View> = {
  customers: "crm", leads: "crm", invoices: "sales", expenses: "finance", employees: "team", projects: "projects",
  tasks: "projects", products: "inventory", vendors: "vendors", documents: "documents", workflows: "automations",
};
export const statuses: Record<RecordKind, string[]> = {
  customers: ["Active", "Inactive"], leads: ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"],
  invoices: ["Unpaid", "Partial", "Paid", "Overdue"], expenses: ["Recorded"], employees: ["Active", "On leave", "Inactive"],
  projects: ["In progress", "Planning", "Completed", "On hold"], tasks: ["To do", "In progress", "Done"],
  products: ["Active", "Discontinued"], vendors: ["Active", "Inactive"], documents: ["Available"], workflows: ["Draft", "Active", "Paused"],
};
