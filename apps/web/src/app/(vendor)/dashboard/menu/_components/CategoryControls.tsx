"use client";

import { createCategoryAction, deleteCategoryAction, type FormState } from "@/app/actions/menu";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import type { Category } from "./types";

const initialState: FormState = {};

export function AddCategoryForm({ vendorId }: { vendorId: string }) {
  const [state, formAction, pending] = useActionState(createCategoryAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-dashed border-[#E4BEB8] px-4 py-2 text-sm font-medium text-[#5B403C] transition-colors hover:border-[#B61913] hover:text-[#B61913]"
      >
        <Plus className="size-4" />
        Add category
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="vendorId" value={vendorId} />
      <input
        name="name"
        placeholder="Category name"
        required
        autoFocus
        className="w-48 rounded-xl border border-[#E4BEB8] bg-white px-3 py-2 text-sm text-[#1C1B1B] placeholder:text-[#5B403C]/60 focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
      />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-2 rounded-xl bg-[#B61913] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#9e1611] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Add
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-sm font-medium text-[#5B403C] hover:text-[#1C1B1B]"
      >
        Cancel
      </button>
      {state.error && <p className="w-full text-sm text-[#BA1A1A]">{state.error}</p>}
    </form>
  );
}

export function DeleteCategoryButton({ vendorId, categoryId }: { vendorId: string; categoryId: string }) {
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    try {
      await deleteCategoryAction(vendorId, categoryId);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleDelete()}
      disabled={pending}
      className="text-[#5B403C]/60 transition-colors hover:text-[#BA1A1A] disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Delete category"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}

/** Category pill list + inline add form — surfaces DeleteCategoryButton so vendors can actually manage categories, not just create them. */
export function CategoryManager({
  vendorId,
  categories,
}: {
  vendorId: string;
  categories: Category[];
}) {
  return (
    <div className="rounded-2xl border border-[#E4BEB8] bg-white p-6 shadow-sm">
      <h3 className="font-sora text-lg font-semibold text-[#1C1B1B]">Categories</h3>
      <p className="mt-1 text-sm text-[#5B403C]">
        Group your menu items so customers can browse by category.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {categories.map((category) => (
          <span
            key={category.id}
            className="flex items-center gap-2 rounded-full bg-[#F6F3F2] py-1.5 pl-3 pr-2 text-sm font-medium text-[#1C1B1B]"
          >
            {category.name}
            <DeleteCategoryButton vendorId={vendorId} categoryId={category.id} />
          </span>
        ))}
        <AddCategoryForm vendorId={vendorId} />
      </div>
    </div>
  );
}
