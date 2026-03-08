export function decodeBase64Unicode(base64: string): string {
  if (typeof window === "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64Unicode(value: string): string {
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

export function decodeSvgDataUri(dataUri: string): string {
  if (!dataUri.startsWith("data:image/svg+xml")) {
    throw new Error("Expected an SVG data URI");
  }

  const commaIndex = dataUri.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid SVG data URI");
  }

  const meta = dataUri.slice(0, commaIndex);
  const data = dataUri.slice(commaIndex + 1);

  if (meta.includes(";base64")) {
    return decodeBase64Unicode(data);
  }

  return decodeURIComponent(data);
}

export function encodeSvgDataUri(
  svg: string,
  mode: "base64" | "utf8" = "base64"
): string {
  if (mode === "utf8") {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  const base64 = encodeBase64Unicode(svg);
  return `data:image/svg+xml;base64,${base64}`;
}

export function injectIntoSvgRoot(svg: string, content: string): string {
  const openTagMatch = svg.match(/<svg\b[^>]*>/i);
  if (!openTagMatch) {
    throw new Error("Invalid SVG markup");
  }

  const openTag = openTagMatch[0];
  return svg.replace(openTag, `${openTag}${content}`);
}

export function setOrReplaceViewBox(
  svg: string,
  viewBox = "0 0 36 36"
): string {
  if (/viewBox="/i.test(svg)) {
    return svg.replace(/viewBox="[^"]*"/i, `viewBox="${viewBox}"`);
  }

  return svg.replace(/<svg\b/i, `<svg viewBox="${viewBox}"`);
}

export type ManipulateSvgOptions = {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  grayscale?: boolean;
  hueRotate?: number;
  scale?: number;
  rotate?: number;
  glow?: boolean;
  pixelated?: boolean;
};

export function manipulateSvgString(
  originalSvg: string,
  options: ManipulateSvgOptions = {}
): string {
  const {
    backgroundColor = "#111111",
    borderColor = "#ffffff",
    borderWidth = 1,
    grayscale = false,
    hueRotate = 0,
    scale = 1,
    rotate = 0,
    glow = false,
    pixelated = true,
  } = options;

  let svg = originalSvg;

  svg = setOrReplaceViewBox(svg, "0 0 36 36");

  const defs = `
    <defs>
      <filter id="monFx">
        ${grayscale ? `<feColorMatrix type="saturate" values="0" />` : ""}
        ${hueRotate ? `<feColorMatrix type="hueRotate" values="${hueRotate}" />` : ""}
        ${
          glow
            ? `
        <feGaussianBlur stdDeviation="0.35" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
        `
            : ""
        }
      </filter>
    </defs>
    <rect x="0" y="0" width="36" height="36" fill="${backgroundColor}" />
    <rect
      x="${borderWidth / 2}"
      y="${borderWidth / 2}"
      width="${36 - borderWidth}"
      height="${36 - borderWidth}"
      fill="none"
      stroke="${borderColor}"
      stroke-width="${borderWidth}"
    />
  `;

  svg = injectIntoSvgRoot(svg, defs);

  svg = svg.replace(/<image\b([^>]*)\/>/i, (_match: string, attrs: string) => {
    const hasStyle = /style="/i.test(attrs);
    const pixelStyle = pixelated
      ? "image-rendering:pixelated;image-rendering:crisp-edges;"
      : "";

    const updatedAttrs = hasStyle
      ? attrs.replace(
          /style="([^"]*)"/i,
          (_s: string, styleValue: string) => {
            const trimmed = styleValue.trim();
            const sep = trimmed === "" || trimmed.endsWith(";") ? "" : ";";
            return `style="${styleValue}${sep}${pixelStyle}"`;
          }
        )
      : `${attrs} style="${pixelStyle}"`;

    return `<g transform="translate(18 18) rotate(${rotate}) scale(${scale}) translate(-18 -18)">
      <image${updatedAttrs} filter="url(#monFx)" />
    </g>`;
  });

  return svg;
}

export function manipulateSvgDataUri(
  svgDataUri: string,
  options: ManipulateSvgOptions = {}
): string {
  const svg = decodeSvgDataUri(svgDataUri);
  const manipulated = manipulateSvgString(svg, options);

  return encodeSvgDataUri(manipulated, "base64");
}