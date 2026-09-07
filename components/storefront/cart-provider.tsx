"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CART_STORAGE_KEY,
  cartItemCount,
  cartSubtotalCents,
  parseCartSnapshot,
  setCartLineQuantity,
  upsertCartLine,
  type CartLine,
  type CartSnapshot,
} from "@/lib/cart";

const CART_EVENT = "dd-cart-change";

type CartContextValue = {
  ready: boolean;
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  addLine: (line: CartLine) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  removeLine: (variantId: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function emitCartChange() {
  window.dispatchEvent(new Event(CART_EVENT));
}

function persist(snapshot: CartSnapshot) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(snapshot));
  emitCartChange();
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CART_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CART_EVENT, onStoreChange);
  };
}

function getCartRaw() {
  return localStorage.getItem(CART_STORAGE_KEY);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, getCartRaw, () => null);
  const snapshot = useMemo(() => parseCartSnapshot(raw), [raw]);

  const commit = useCallback((lines: CartLine[]) => {
    persist({ lines, updatedAt: new Date().toISOString() });
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      ready: true,
      lines: snapshot.lines,
      itemCount: cartItemCount(snapshot.lines),
      subtotalCents: cartSubtotalCents(snapshot.lines),
      addLine: (line) => commit(upsertCartLine(snapshot.lines, line)),
      setQuantity: (variantId, quantity) =>
        commit(setCartLineQuantity(snapshot.lines, variantId, quantity)),
      removeLine: (variantId) =>
        commit(snapshot.lines.filter((line) => line.variantId !== variantId)),
      clear: () => commit([]),
    }),
    [commit, snapshot.lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within CartProvider");
  }
  return context;
}
