export function decodeBase64Unicode(base64: string) {
  if (typeof window === "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64Unicode(value: string) {
  if (typeof window === "undefined") {
    return Buffer.from(value, "utf-8").toString("base64");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function encodeSvgDataUri(svg: string, mode: "base64" | "utf8" = "base64") {
  if (mode === "utf8") {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  return `data:image/svg+xml;base64,${encodeBase64Unicode(svg)}`;
}

export function normalizeSvgInput(input: string) {
  if (!input) {
    throw new Error("Missing SVG input");
  }

  if (input.startsWith("data:image/svg+xml")) {
    return input;
  }

  if (input.trim().startsWith("<svg")) {
    return encodeSvgDataUri(input, "utf8");
  }

  throw new Error(
    "Expected SVG input as either a data:image/svg+xml URI or raw <svg> markup"
  );
}

export function decodeSvgDataUri(dataUri: string) {
  const normalized = normalizeSvgInput(dataUri);

  const commaIndex = normalized.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid SVG data URI");
  }

  const meta = normalized.slice(0, commaIndex);
  const data = normalized.slice(commaIndex + 1);

  if (meta.includes(";base64")) {
    return decodeBase64Unicode(data);
  }

  return decodeURIComponent(data);
}