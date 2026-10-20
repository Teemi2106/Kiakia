/**
 * A UUIDv7: 48-bit millisecond timestamp, then random. cart_items ids are
 * UUIDv7 in the database and customer_bootstrap() returns lines ordered by
 * id, so a line id minted here has to sort by creation time too or a cart
 * would reshuffle after a reload.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const high = Math.floor(now / 2 ** 16);
  const low = now % 2 ** 16;
  bytes[0] = high >>> 24;
  bytes[1] = (high >>> 16) & 0xff;
  bytes[2] = (high >>> 8) & 0xff;
  bytes[3] = high & 0xff;
  bytes[4] = low >>> 8;
  bytes[5] = low & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
