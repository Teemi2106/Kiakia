// app/(vendor)/dashboard/settings/_components/StaffMembers.tsx
"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2, User, X } from "lucide-react";
import {
  inviteStaffMemberAction,
  removeStaffMemberAction,
  type FormState,
} from "@/app/actions/vendor";
import type { StaffMember, VendorSettings, VendorStaffRole } from "./types";

const ROLE_LABELS: Record<VendorStaffRole, string> = {
  vendor_owner: "Owner",
  vendor_manager: "Manager",
  vendor_staff: "Staff",
};

const inviteInitialState: FormState = {};

export function StaffMembers({ vendor }: { vendor: VendorSettings }) {
  const isOwner = vendor.currentUserRole === "vendor_owner";
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div className="rounded-2xl border border-kk-line bg-kk-card p-6 shadow-sm">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-sora text-2xl font-semibold text-kk-ink">Staff Members</h2>
          <p className="text-sm text-kk-cocoa">
            {isOwner
              ? "Manage who has access to this store's dashboard."
              : "Only the store owner can invite or remove staff."}
          </p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowInvite((v) => !v)}
            className="flex items-center gap-2 rounded-xl border-2 border-dashed border-kk-line px-4 py-2 font-inter text-sm font-medium text-kk-cocoa transition-colors hover:bg-kk-sand"
          >
            {showInvite ? <X className="size-4" /> : <Plus className="size-4" />}
            {showInvite ? "Cancel" : "Invite New Member"}
          </button>
        )}
      </div>

      {isOwner && showInvite && (
        <InviteStaffForm vendorId={vendor.id} onInvited={() => setShowInvite(false)} />
      )}

      <div className="mt-6 space-y-3">
        {vendor.staff.map((member) => (
          <StaffRow key={member.userId} vendorId={vendor.id} member={member} canManage={isOwner} />
        ))}
      </div>
    </div>
  );
}

function InviteStaffForm({ vendorId, onInvited }: { vendorId: string; onInvited: () => void }) {
  const [state, formAction, pending] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await inviteStaffMemberAction(prev, formData);
    if (result.success) onInvited();
    return result;
  }, inviteInitialState);

  return (
    <form action={formAction} className="mb-6 rounded-xl border border-kk-line bg-kk-sand p-4">
      <input type="hidden" name="vendorId" value={vendorId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="staff-email" className="mb-1 block font-inter text-xs font-medium text-kk-ink">
            Email address
          </label>
          <input
            id="staff-email"
            name="email"
            type="email"
            required
            placeholder="teammate@example.com"
            className="w-full rounded-xl border border-kk-line bg-kk-card p-2 font-inter text-sm focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red-ink/20"
          />
        </div>

        <div>
          <label htmlFor="staff-role" className="mb-1 block font-inter text-xs font-medium text-kk-ink">
            Role
          </label>
          <select
            id="staff-role"
            name="role"
            defaultValue="vendor_staff"
            className="w-full rounded-xl border border-kk-line bg-kk-card p-2 font-inter text-sm focus:border-kk-red focus:outline-none focus:ring-2 focus:ring-kk-red-ink/20"
          >
            <option value="vendor_staff">Staff</option>
            <option value="vendor_manager">Manager</option>
            <option value="vendor_owner">Owner</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-kk-red px-6 py-2 font-inter text-sm font-medium text-white transition-colors hover:bg-kk-red-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>

      <p className="mt-2 text-xs text-kk-cocoa">
        This doesn&apos;t send an email invite — it only works if that address already has a KiaKia account.
      </p>

      {state.error && <p className="mt-2 text-sm text-kk-danger-ink">{state.error}</p>}
    </form>
  );
}

function StaffRow({
  vendorId,
  member,
  canManage,
}: {
  vendorId: string;
  member: StaffMember;
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleRemove() {
    setPending(true);
    setError(null);
    const result = await removeStaffMemberAction(vendorId, member.userId);
    if (result.error) {
      setError(result.error);
      setPending(false);
    }
    // On success the row disappears via revalidatePath's refetch of vendor.staff.
  }

  const displayName = member.fullName ?? "Unnamed";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className="rounded-xl border border-kk-line bg-kk-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-notice-surface font-bold text-kk-orange-ink">
            {initials === "?" ? <User className="size-5" /> : initials}
          </div>
          <div>
            <p className="font-inter text-sm font-semibold text-kk-ink">
              {displayName}
              {member.isSelf && <span className="ml-1 font-normal text-kk-cocoa">(you)</span>}
            </p>
            <p className="text-xs text-kk-cocoa">{ROLE_LABELS[member.role]}</p>
          </div>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={pending}
            aria-label={`Remove ${displayName}`}
            className="rounded-full p-2 text-kk-cocoa transition-colors hover:bg-kk-sand hover:text-kk-danger-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="size-5" />
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-kk-danger-ink">{error}</p>}
    </div>
  );
}
