"use client";

import { Button, Input } from "@kiakia/ui";
import { Trash2 } from "lucide-react";

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
    <div className="flex flex-col gap-4">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="rounded-control border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Group name (e.g. Size, Extras)"
              value={group.name}
              onChange={(e) => updateGroup(groupIndex, { name: e.target.value })}
              className="flex-1"
            />
            <button type="button" onClick={() => removeGroup(groupIndex)} className="text-ink-muted hover:text-danger" aria-label="Remove group">
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-muted">
            <label className="flex items-center gap-1">
              Min
              <input
                type="number"
                min={0}
                value={group.minSelect}
                onChange={(e) => updateGroup(groupIndex, { minSelect: Number(e.target.value) })}
                className="w-14 rounded border border-border px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-1">
              Max
              <input
                type="number"
                min={1}
                value={group.maxSelect}
                onChange={(e) => updateGroup(groupIndex, { maxSelect: Number(e.target.value) })}
                className="w-14 rounded border border-border px-1 py-0.5"
              />
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={group.isRequired}
                onChange={(e) => updateGroup(groupIndex, { isRequired: e.target.checked })}
              />
              Required
            </label>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {group.options.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-2">
                <Input
                  placeholder="Option name"
                  value={option.name}
                  onChange={(e) => updateOption(groupIndex, optionIndex, { name: e.target.value })}
                  className="flex-1"
                />
                <input
                  type="number"
                  placeholder="+₦"
                  value={option.priceDeltaNaira}
                  onChange={(e) => updateOption(groupIndex, optionIndex, { priceDeltaNaira: Number(e.target.value) })}
                  className="w-20 rounded-control border border-border px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeOption(groupIndex, optionIndex)}
                  className="text-ink-muted hover:text-danger"
                  aria-label="Remove option"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => addOption(groupIndex)} className="self-start">
              + Add option
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={addGroup} className="self-start">
        + Add option group
      </Button>
    </div>
  );
}
