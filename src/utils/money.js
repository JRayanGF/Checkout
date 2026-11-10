export function couponIsUsable(c, now = new Date()) {
  if (!c || !c.active) return false;
  if (c.expires_at && new Date(c.expires_at) < now) return false;
  if (c.max_uses != null && c.used_count >= c.max_uses) return false;
  return true;
}

/** Todos os valores em centavos (inteiros). */
export function computeTotals(unitCents, quantity, coupon) {
  const subtotal = unitCents * quantity;
  let discount = 0;
  if (coupon) {
    discount = coupon.type === 'percent'
      ? Math.floor((subtotal * Math.min(coupon.value, 100)) / 100)
      : Math.min(coupon.value, subtotal);
  }
  return { subtotal, discount, total: subtotal - discount };
}

export const toReais = (cents) => Number((cents / 100).toFixed(2));
