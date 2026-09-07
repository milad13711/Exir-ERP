"use client";

/**
 * سبد خرید فروشگاه آنلاین عمومی — کاملاً سمت مرورگر (localStorage)، بدون
 * نیاز به ورود بازدیدکننده. sessionToken یک شناسه‌ی تصادفی است که یک‌بار
 * برای هر «فروشگاه» (slug تننت) ساخته و نگه داشته می‌شود تا رویدادهای
 * تحلیلی (بازدید، افزودن به سبد، سفارش) به همان بازدیدکننده وصل بمانند.
 */

export type CartLine = { productId: string; name: string; price: number; quantity: number };
export type Cart = Record<string, CartLine>;

function cartKey(slug: string) {
  return `exir_store_cart_${slug}`;
}
function sessionKey(slug: string) {
  return `exir_store_session_${slug}`;
}

export function getSessionToken(slug: string): string {
  if (typeof window === "undefined") return "";
  let token = window.localStorage.getItem(sessionKey(slug));
  if (!token) {
    token = crypto.randomUUID();
    window.localStorage.setItem(sessionKey(slug), token);
  }
  return token;
}

export function getCart(slug: string): Cart {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(cartKey(slug));
    return raw ? (JSON.parse(raw) as Cart) : {};
  } catch {
    return {};
  }
}

function saveCart(slug: string, cart: Cart) {
  window.localStorage.setItem(cartKey(slug), JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent("exir-store-cart-changed", { detail: { slug } }));
}

export function addToCart(slug: string, line: { productId: string; name: string; price: number }, quantity = 1): Cart {
  const cart = getCart(slug);
  const existing = cart[line.productId];
  cart[line.productId] = {
    productId: line.productId,
    name: line.name,
    price: line.price,
    quantity: (existing?.quantity ?? 0) + quantity,
  };
  saveCart(slug, cart);
  return cart;
}

export function setCartQuantity(slug: string, productId: string, quantity: number): Cart {
  const cart = getCart(slug);
  if (quantity <= 0) {
    delete cart[productId];
  } else if (cart[productId]) {
    cart[productId] = { ...cart[productId], quantity };
  }
  saveCart(slug, cart);
  return cart;
}

export function removeFromCart(slug: string, productId: string): Cart {
  const cart = getCart(slug);
  delete cart[productId];
  saveCart(slug, cart);
  return cart;
}

export function clearCart(slug: string) {
  saveCart(slug, {});
}

export function cartCount(cart: Cart): number {
  return Object.values(cart).reduce((sum, l) => sum + l.quantity, 0);
}

export function cartTotal(cart: Cart): number {
  return Object.values(cart).reduce((sum, l) => sum + l.price * l.quantity, 0);
}
