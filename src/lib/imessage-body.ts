// Newer macOS versions leave message.text NULL and store the text only in
// message.attributedBody, an NSAttributedString in Apple's typedstream
// format. We don't need the attributes, just the string: it follows the
// "NSString" class name, a short preamble ending in "+", then a length.
// Length is one byte, or 0x81 + uint16 LE, or 0x82 + uint32 LE.
export function decodeAttributedBody(buf: Buffer | Uint8Array | null | undefined): string | null {
  if (!buf || !buf.length) return null;
  const b = Buffer.from(buf);
  const marker = b.indexOf("NSString");
  if (marker < 0) return null;
  let i = b.indexOf(0x2b, marker + 8); // '+'
  if (i < 0 || i > marker + 20) return null;
  i++;
  let len = b[i];
  i++;
  if (len === 0x81) {
    len = b.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    len = b.readUInt32LE(i);
    i += 4;
  }
  if (!len || i + len > b.length) return null;
  const text = b.subarray(i, i + len).toString("utf8").replace(/￼/g, "").trim();
  return text || null;
}
