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
        <div key={groupIndex} className="rounded-xl border border-kk-line bg-kk-sand p-4">
          <div className="flex items-center gap-2">
            <input
              placeholder="Group name (e.g. Size, Extras)"
              value={group.name}
              onChange={(e) => updateGroup(groupIndex, { name: e.target.value })}
              className="flex-1 rounded-lg border border-kk-line bg-kk-card px-3 py-2 text-sm text-kk-ink outline-none placeholder:text-kk-cocoa/50 focus:border-kk-red focus:ring-2 focus:ring-kk-red-ink/20"
            />
            <button
              type="button"
              onClick={() => removeGroup(groupIndex)}
              className="rounded-lg p-2 text-kk-cocoa transition-colors hover:bg-kk-danger-wash hover:text-kk-danger-ink"
              aria-label="Remove group"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-medium text-kk-cocoa">
            <label className="flex items-center gap-1.5">
              Min
              <input
                type="number"
                min={group.isRequired ? 1 : 0}
                value={group.minSelect}
                onChange={(e) =>
                  updateGroup(groupIndex, {
                    minSelect: Math.max(Number(e.target.value), group.isRequired ? 1 : 0),
                  })
                }
                className="w-14 rounded-lg border border-kk-line bg-kk-card px-2 py-1 text-kk-ink outline-none focus:border-kk-red"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Max
              <input
                type="number"
                min={1}
                value={group.maxSelect}
                onChange={(e) => updateGroup(groupIndex, { maxSelect: Number(e.target.value) })}
                className="w-14 rounded-lg border border-kk-line bg-kk-card px-2 py-1 text-kk-ink outline-none focus:border-kk-red"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={group.isRequired}
                onChange={(e) => {
                  const isRequired = e.target.checked;
                  // A customer never sees minSelect - they see "Required".
                  // Letting the two fields drift (required, but minSelect
                  // still 0) is what let an order through with no takeaway
                  // pack picked, so checking this box always guarantees at
                  // least one selection is actually enforced.
                  updateGroup(groupIndex, {
                    isRequired,
                    minSelect: isRequired ? Math.max(group.minSelect, 1) : group.minSelect,
                  });
                }}
                className="size-4 rounded border-kk-line text-kk-red-ink focus:ring-kk-red-ink/40"
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
                  className="flex-1 rounded-lg border border-kk-line bg-kk-card px-3 py-1.5 text-sm text-kk-ink outline-none placeholder:text-kk-cocoa/50 focus:border-kk-red focus:ring-2 focus:ring-kk-red-ink/20"
                />
                <input
                  type="number"
                  placeholder="+₦"
                  value={option.priceDeltaNaira}
                  onChange={(e) => updateOption(groupIndex, optionIndex, { priceDeltaNaira: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-kk-line bg-kk-card px-2 py-1.5 text-sm text-kk-ink outline-none focus:border-kk-red"
                />
                <button
                  type="button"
                  onClick={() => removeOption(groupIndex, optionIndex)}
                  className="rounded-lg p-1.5 text-kk-cocoa transition-colors hover:bg-kk-danger-wash hover:text-kk-danger-ink"
                  aria-label="Remove option"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addOption(groupIndex)}
              className="flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm font-medium text-kk-red-ink transition-colors hover:bg-kk-red/10"
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
        className="flex items-center justify-center gap-2 self-start rounded-xl border border-dashed border-kk-line px-4 py-2 text-sm font-medium text-kk-cocoa transition-colors hover:border-kk-red hover:text-kk-red-ink"
      >
        <Plus className="size-4" />
        Add option group
      </button>
    </div>
  );
}
