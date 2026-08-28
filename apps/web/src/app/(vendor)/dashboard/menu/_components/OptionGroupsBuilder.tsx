"use client";

import { Plus, Trash2 } from "lucide-react";

export interface OptionGroupState {
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: { name: string; priceDeltaNaira: number }[];
}

/** Nested option-groups editor for a menu item — inline on the item form, not a separate CRUD screen (per plan). */
export function OptionGroupsBuilder({
  groups,
  onChange,
}: {
  groups: readonly OptionGroupState[];
  onChange: (groups: OptionGroupState[]) => void;
}) {
  function updateGroup(index: number, patch: Partial<OptionGroupState>) {
    onChange(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function addGroup() {
    onChange([...groups, { name: "", minSelect: 0, maxSelect: 1, isRequired: false, options: [] }]);
  }

  function removeGroup(index: number) {
    onChange(groups.filter((_, i) => i !== index));
  }

  function addOption(groupIndex: number) {
    updateGroup(groupIndex, {
      options: [...groups[groupIndex]!.options, { name: "", priceDeltaNaira: 0 }],
    });
  }

  function updateOption(groupIndex: number, optionIndex: number, patch: Partial<{ name: string; priceDeltaNaira: number }>) {
    const group = groups[groupIndex]!;
    updateGroup(groupIndex, {
      options: group.options.map((o, i) => (i === optionIndex ? { ...o, ...patch } : o)),
    });
  }

  function removeOption(groupIndex: number, optionIndex: number) {
    const group = groups[groupIndex]!;
    updateGroup(groupIndex, { options: group.options.filter((_, i) => i !== optionIndex) });
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="rounded-xl border border-[#E4BEB8] bg-[#F6F3F2] p-4">
          <div className="flex items-center gap-2">
            <input
              placeholder="Group name (e.g. Size, Extras)"
              value={group.name}
              onChange={(e) => updateGroup(groupIndex, { name: e.target.value })}
              className="flex-1 rounded-lg border border-[#E4BEB8] bg-white px-3 py-2 text-sm text-[#1C1B1B] outline-none placeholder:text-[#5B403C]/50 focus:border-[#B61913] focus:ring-2 focus:ring-[#B61913]/20"
            />
            <button
              type="button"
              onClick={() => removeGroup(groupIndex)}
              className="rounded-lg p-2 text-[#5B403C] transition-colors hover:bg-[#FFDAD5] hover:text-[#BA1A1A]"
              aria-label="Remove group"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-medium text-[#5B403C]">
            <label className="flex items-center gap-1.5">
              Min
              <input
                type="number"
                min={0}
                value={group.minSelect}
                onChange={(e) => updateGroup(groupIndex, { minSelect: Number(e.target.value) })}
                className="w-14 rounded-lg border border-[#E4BEB8] bg-white px-2 py-1 text-[#1C1B1B] outline-none focus:border-[#B61913]"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Max
              <input
                type="number"
                min={1}
                value={group.maxSelect}
                onChange={(e) => updateGroup(groupIndex, { maxSelect: Number(e.target.value) })}
                className="w-14 rounded-lg border border-[#E4BEB8] bg-white px-2 py-1 text-[#1C1B1B] outline-none focus:border-[#B61913]"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={group.isRequired}
                onChange={(e) => updateGroup(groupIndex, { isRequired: e.target.checked })}
                className="size-4 rounded border-[#E4BEB8] text-[#B61913] focus:ring-[#B61913]/40"
              />
              Required
            </label>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {group.options.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-2">
                <input
                  placeholder="Option name"
                  value={option.name}
                  onChange={(e) => updateOption(groupIndex, optionIndex, { name: e.target.value })}
                  className="flex-1 rounded-lg border border-[#E4BEB8] bg-white px-3 py-1.5 text-sm text-[#1C1B1B] outline-none placeholder:text-[#5B403C]/50 focus:border-[#B61913] focus:ring-2 focus:ring-[#B61913]/20"
                />
                <input
                  type="number"
                  placeholder="+₦"
                  value={option.priceDeltaNaira}
                  onChange={(e) => updateOption(groupIndex, optionIndex, { priceDeltaNaira: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-[#E4BEB8] bg-white px-2 py-1.5 text-sm text-[#1C1B1B] outline-none focus:border-[#B61913]"
                />
                <button
                  type="button"
                  onClick={() => removeOption(groupIndex, optionIndex)}
                  className="rounded-lg p-1.5 text-[#5B403C] transition-colors hover:bg-[#FFDAD5] hover:text-[#BA1A1A]"
                  aria-label="Remove option"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addOption(groupIndex)}
              className="flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm font-medium text-[#B61913] transition-colors hover:bg-[#B61913]/10"
            >
              <Plus className="size-3.5" />
              Add option
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addGroup}
        className="flex items-center justify-center gap-2 self-start rounded-xl border border-dashed border-[#E4BEB8] px-4 py-2 text-sm font-medium text-[#5B403C] transition-colors hover:border-[#B61913] hover:text-[#B61913]"
      >
        <Plus className="size-4" />
        Add option group
      </button>
    </div>
  );
}
