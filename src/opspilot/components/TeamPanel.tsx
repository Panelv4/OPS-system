"use client";
import { useEffect, useState } from "react";
import { Check, Loader2, Mail, UserPlus, Users } from "lucide-react";
import { api } from "../lib/client";
import { Avatar, Badge, Button } from "./UI";
import { Field } from "./RecordForms";

/**
 * Member management UI. The API (`GET/POST /api/members`, `POST /api/members/accept`)
 * shipped earlier; without this panel the only way to add a teammate was curl, so
 * seats were a feature nobody could reach.
 */

type Member = { id: string; name: string; email: string; role: string; emailVerified: boolean };
type Invitation = { email: string; role: string | null; expiresAt: string };
type Roster = { members: Member[]; invitations: Invitation[] };

const ROLES = ["administrator", "manager", "accountant", "salesperson", "hr_manager", "employee"] as const;

export function TeamPanel({ role, toast }: { role: string; toast: (message: string) => void }) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("employee");
  const [busy, setBusy] = useState(false);

  const canInvite = role === "owner" || role === "administrator";

  async function load() {
    try {
      setRoster(await api<Roster>("/api/members"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your team.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    api<Roster>("/api/members")
      .then((result) => { if (!cancelled) setRoster(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load your team."); });
    return () => { cancelled = true; };
  }, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ delivery?: string; notice?: string }>("/api/members", "POST", { email, role: inviteRole });
      setNotice(
        result.delivery === "sent"
          ? `Invitation sent to ${email}. The link expires in 7 days.`
          : result.notice ?? "Invitation created. Email delivery is not configured on this deployment, so copy the link from the server log.",
      );
      setEmail("");
      await load();
      toast("Invitation created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to invite that address.");
    } finally { setBusy(false); }
  }

  if (error && !roster) return <div className="form-error" role="alert">{error}</div>;
  if (!roster) return <div className="settings-notice" role="status"><Loader2 size={18}/><p>Loading your team…</p></div>;

  return (
    <div>
      <div className="settings-section-header">
        <h2>Your team</h2>
        <p>Everyone with access to this workspace, and the invitations still waiting.</p>
      </div>

      <div className="security-features">
        {roster.members.map((member) => (
          <div key={member.id}>
            <Avatar name={member.name} />
            <span>
              <strong>{member.name}{member.id === roster.members[0]?.id ? "" : ""}</strong>
              <p>{member.email}{member.emailVerified ? "" : " · email not confirmed"}</p>
            </span>
            <Badge tone={member.role === "owner" ? "green" : undefined}>{member.role.replaceAll("_", " ")}</Badge>
          </div>
        ))}
      </div>

      {roster.invitations.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 className="settings-label">Pending invitations</h3>
          {roster.invitations.map((invitation) => (
            <div key={invitation.email} className="settings-row" style={{ alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Mail size={16} />
                <span>
                  <strong>{invitation.email}</strong>
                  <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>
                    {invitation.role?.replaceAll("_", " ") ?? "member"} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
                  </p>
                </span>
              </div>
              <Badge tone="amber">Waiting</Badge>
            </div>
          ))}
        </div>
      )}

      {canInvite ? (
        <form onSubmit={invite} style={{ marginTop: 20 }}>
          <h3 className="settings-label">Invite someone</h3>
          <Field label="Email address">
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@their-agency.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Role" hint="Roles decide which modules a member can open. Only owners and administrators can invite.">
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              {ROLES.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
            </select>
          </Field>
          {notice && <div className="settings-notice" role="status"><Check size={18}/><p>{notice}</p></div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="settings-footer">
            <Button type="submit" busy={busy} disabled={!email}>
              <UserPlus size={15}/>Send invitation
            </Button>
          </div>
        </form>
      ) : (
        <div className="settings-notice" role="note">
          <Users size={19}/>
          <p>Only owners and administrators can invite members. Ask one of them to add a teammate.</p>
        </div>
      )}

      <p style={{ opacity: 0.7, fontSize: 13, marginTop: 12 }}>
        Seats are enforced by your plan: an invitation that would exceed the seat count is refused with a 402 until you
        upgrade or remove a member.
      </p>
    </div>
  );
}
