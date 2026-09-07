"use client";

/** لیست علاقه‌مندی‌های فروشگاه آنلاین — کاملاً سمت مرورگر، مثل سبد خرید. */

function wishlistKey(slug: string) {
  return `exir_store_wishlist_${slug}`;
}

export function getWishlist(slug: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(wishlistKey(slug));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveWishlist(slug: string, ids: string[]) {
  window.localStorage.setItem(wishlistKey(slug), JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent("exir-store-wishlist-changed", { detail: { slug } }));
}

export function isWishlisted(slug: string, productId: string): boolean {
  return getWishlist(slug).includes(productId);
}

export function toggleWishlist(slug: string, productId: string): string[] {
  const list = getWishlist(slug);
  const next = list.includes(productId) ? list.filter((id) => id !== productId) : [...list, productId];
  saveWishlist(slug, next);
  return next;
}
