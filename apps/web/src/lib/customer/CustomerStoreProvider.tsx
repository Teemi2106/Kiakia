"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createCustomerStore, type CustomerState, type CustomerStore } from "./store";
import type { CustomerSnapshot } from "./types";

const StoreContext = createContext<CustomerStore | null>(null);

/**
 * Owns the customer store for the (customer) layout. The store is created
 * once from the server snapshot and then lives on the client, so optimistic
 * cart state survives navigation. The layout itself only re-renders on a hard
 * load, router.refresh() or a Server Action, and each of those hands down a
 * fresh snapshot, which hydrate() folds in (see its rules in store.ts).
 * Keyed by user so a different account never inherits the previous one's cart.
 */
export function CustomerStoreProvider({
  snapshot,
  children,
}: {
  snapshot: CustomerSnapshot;
  children: React.ReactNode;
}) {
  return (
    <CustomerStoreBoundary key={snapshot.userId} snapshot={snapshot}>
      {children}
    </CustomerStoreBoundary>
  );
}

function CustomerStoreBoundary({ snapshot, children }: { snapshot: CustomerSnapshot; children: React.ReactNode }) {
  const [store] = useState(() => createCustomerStore(snapshot));
  const seeded = useRef(snapshot);

  useEffect(() => {
    if (seeded.current === snapshot) return;
    seeded.current = snapshot;
    store.getState().hydrate(snapshot);
  }, [snapshot, store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useCustomerStore<T>(selector: (state: CustomerState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useCustomerStore must be used within CustomerStoreProvider");
  return useStore(store, selector);
}
