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
    <div className="rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">Staff Members</h2>
          <p className="text-sm text-[#5B403C]">
            {isOwner
              ? "Manage who has access to this store's dashboard."
              : "Only the store owner can invite or remove staff."}
          </p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowInvite((v) => !v)}
            className="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#E4BEB8] px-4 py-2 font-inter text-sm font-medium text-[#5B403C] transition-colors hover:bg-[#F6F3F2]"
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
    <form action={formAction} className="mb-6 rounded-xl border border-[#E4BEB8] bg-[#F6F3F2] p-4">
      <input type="hidden" name="vendorId" value={vendorId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="staff-email" className="mb-1 block font-inter text-xs font-medium text-[#1C1B1B]">
            Email address
          </label>
          <input
            id="staff-email"
            name="email"
            type="email"
            required
            placeholder="teammate@example.com"
            className="w-full rounded-xl border border-[#E4BEB8] bg-white p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          />
        </div>

        <div>
          <label htmlFor="staff-role" className="mb-1 block font-inter text-xs font-medium text-[#1C1B1B]">
            Role
          </label>
          <select
            id="staff-role"
            name="role"
            defaultValue="vendor_staff"
            className="w-full rounded-xl border border-[#E4BEB8] bg-white p-2 font-inter text-sm focus:border-[#B61913] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
          >
            <option value="vendor_staff">Staff</option>
            <option value="vendor_manager">Manager</option>
            <option value="vendor_owner">Owner</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-[#B61913] px-6 py-2 font-inter text-sm font-medium text-white transition-colors hover:bg-[#9e1611] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>

      <p className="mt-2 text-xs text-[#5B403C]">
        This doesn&apos;t send an email invite — it only works if that address already has a KiaKia account.
      </p>

      {state.error && <p className="mt-2 text-sm text-[#BA1A1A]">{state.error}</p>}
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
    <div className="rounded-xl border border-[#E4BEB8] bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFDCC5] font-bold text-[#934B00]">
            {initials === "?" ? <User className="size-5" /> : initials}
          </div>
          <div>
            <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
              {displayName}
              {member.isSelf && <span className="ml-1 font-normal text-[#5B403C]">(you)</span>}
            </p>
            <p className="text-xs text-[#5B403C]">{ROLE_LABELS[member.role]}</p>
          </div>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={pending}
            aria-label={`Remove ${displayName}`}
            className="rounded-full p-2 text-[#5B403C] transition-colors hover:bg-[#F6F3F2] hover:text-[#BA1A1A] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="size-5" />
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-[#BA1A1A]">{error}</p>}
    </div>
  );
}
