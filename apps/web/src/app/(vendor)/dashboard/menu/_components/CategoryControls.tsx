"use client";

import { createCategoryAction, deleteCategoryAction, type FormState } from "@/app/actions/menu";
import { Button, Input } from "@kiakia/ui";
import { Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

const initialState: FormState = {};

export function AddCategoryForm({ vendorId }: { vendorId: string }) {
  const [state, formAction, pending] = useActionState(createCategoryAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Add category
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="vendorId" value={vendorId} />
      <Input name="name" placeholder="Category name" required autoFocus className="w-48" />
      <Button type="submit" loading={pending}>
        Add
      </Button>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function DeleteCategoryButton({ vendorId, categoryId }: { vendorId: string; categoryId: string }) {
  return (
    <button
      type="button"
      onClick={() => void deleteCategoryAction(vendorId, categoryId)}
      className="text-ink-muted hover:text-danger"
      aria-label="Delete category"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
