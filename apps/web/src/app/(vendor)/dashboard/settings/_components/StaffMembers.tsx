// app/(vendor)/settings/_components/StaffMembers.tsx
"use client";

import { Plus, MoreVertical, User } from "lucide-react";

const STAFF = [
  { id: "1", name: "John Doe", role: "Manager", initials: "JD" },
  { id: "2", name: "Alice Smith", role: "Chef", initials: "AS" },
];

export function StaffMembers() {
  return (
    <div className="rounded-xl border border-[#E4BEB8] bg-white p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
            Staff Members
          </h2>
          <p className="text-sm text-[#5B403C]">
            Manage team access and permissions.
          </p>
        </div>
        <button className="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#E4BEB8] px-4 py-2 font-inter text-sm font-medium text-[#5B403C] transition-colors hover:bg-[#F6F3F2]">
          <Plus className="size-4" />
          Invite New Member
        </button>
      </div>

      <div className="space-y-3">
        {STAFF.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-xl border border-[#E4BEB8] bg-white p-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFDCC5] font-bold text-[#934B00]">
                {member.initials}
              </div>
              <div>
                <p className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {member.name}
                </p>
                <p className="text-xs text-[#5B403C]">{member.role}</p>
              </div>
            </div>
            <button className="rounded-full p-2 transition-colors hover:bg-[#F6F3F2]">
              <MoreVertical className="size-5 text-[#5B403C]" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
