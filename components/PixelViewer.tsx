"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeSvgDataUri } from "@/lib/svg-utils";
import StickerEditor from "@/components/StickerEditor";

const TOTAL_TOKENS = 10000;
const TARGET_EXPORT_SIZE = 720;
const SOURCE_SIZE = 36;
const MAX_FRAME = 12;
const MAX_PREVIEW_SCALE = 10;

const THEMES = {
  normie: { name: "Normie" },
  eth: { name: "Eth" },
} as const;

type ThemeKey = keyof typeof THEMES;

type StickerData = {
  width: number;
  height: number;
  pixels: string[];
};

function getRandomTokenId(exclude?: number) {
  let next = Math.floor(Math.random() * TOTAL_TOKENS) + 1;

  if (exclude === undefined || TOTAL_TOKENS <= 1) {
    return next;
  }

  while (next === exclude) {
    next = Math.floor(Math.random() * TOTAL_TOKENS) + 1;
  }

  return next;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getLuminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function extractEmbeddedPng(svg: string) {
  const pngMatch = svg.match(/href="(data:image\/png;base64,[^"]+)"/i);
  return pngMatch?.[1] ?? null;
}

function getThemeColors() {
  if (typeof window === "undefined") {
    return {
      on: "#48494b",
      off: "#e3e5e4",
    };
  }

  const styles = getComputedStyle(document.documentElement);

  return {
    on: styles.getPropertyValue("--pixel-on").trim() || "#48494b",
    off: styles.getPropertyValue("--pixel-off").trim() || "#e3e5e4",
  };
}

function applyThresholdTo36x36(
  imageData: ImageData,
  threshold: number
): Uint8Array {
  const out = new Uint8Array(SOURCE_SIZE * SOURCE_SIZE);
  const data = imageData.data;

  for (let y = 0; y < SOURCE_SIZE; y++) {
    for (let x = 0; x < SOURCE_SIZE; x++) {
      const idx = (y * SOURCE_SIZE + x) * 4;
      const a = data[idx + 3];

      if (a === 0) {
        out[y * SOURCE_SIZE + x] = 0;
        continue;
      }

      const lum = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
      out[y * SOURCE_SIZE + x] = lum < threshold ? 1 : 0;
    }
  }

  return out;
}

function applyBayerTo36x36(
  grayImage: ImageData,
  threshold: number,
  strength: number
): Uint8Array {
  const out = new Uint8Array(SOURCE_SIZE * SOURCE_SIZE);
  const data = grayImage.data;

  const matrix = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];

  for (let y = 0; y < SOURCE_SIZE; y++) {
    for (let x = 0; x < SOURCE_SIZE; x++) {
      const idx = (y * SOURCE_SIZE + x) * 4;
      const a = data[idx + 3];

      if (a === 0) {
        out[y * SOURCE_SIZE + x] = 0;
        continue;
      }

      const lum = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
      const pattern = (matrix[y % 4][x % 4] / 16 - 0.5) * strength;
      const adjustedThreshold = threshold + pattern;
      out[y * SOURCE_SIZE + x] = lum < adjustedThreshold ? 1 : 0;
    }
  }

  return out;
}

function place36IntoFrame(source36: Uint8Array, frame: number) {
  const framedSize = SOURCE_SIZE + frame * 2;
  const out = new Uint8Array(framedSize * framedSize);

  for (let y = 0; y < SOURCE_SIZE; y++) {
    for (let x = 0; x < SOURCE_SIZE; x++) {
      out[(y + frame) * framedSize + (x + frame)] =
        source36[y * SOURCE_SIZE + x];
    }
  }

  return { bits: out, size: framedSize };
}

function invertBits(bits: Uint8Array) {
  const out = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) {
    out[i] = bits[i] ? 0 : 1;
  }
  return out;
}

function drawBitmap(
  ctx: CanvasRenderingContext2D,
  bits: Uint8Array,
  bitmapSize: number,
  canvasSize: number
) {
  const scale = canvasSize / bitmapSize;
  const colors = getThemeColors();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  ctx.fillStyle = colors.off;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  for (let y = 0; y < bitmapSize; y++) {
    for (let x = 0; x < bitmapSize; x++) {
      const value = bits[y * bitmapSize + x];
      ctx.fillStyle = value ? colors.on : colors.off;
      ctx.fillRect(
        Math.round(x * scale),
        Math.round(y * scale),
        Math.ceil(scale),
        Math.ceil(scale)
      );
    }
  }
}

function getCleanExportSize(bitmapSize: number) {
  const scale = Math.max(1, Math.round(TARGET_EXPORT_SIZE / bitmapSize));
  return bitmapSize * scale;
}

async function cc0monImageToBits(
  embeddedPng: string,
  threshold: number,
  bayer: number,
  invert: boolean,
  frame: number
) {
  const img = new Image();
  img.src = embeddedPng;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load CC0mon PNG"));
  });

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = SOURCE_SIZE;
  tempCanvas.height = SOURCE_SIZE;

  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!tempCtx) {
    throw new Error("Could not create temp canvas");
  }

  tempCtx.imageSmoothingEnabled = false;
  tempCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
  tempCtx.drawImage(img, 0, 0, SOURCE_SIZE, SOURCE_SIZE);

  const imageData = tempCtx.getImageData(0, 0, SOURCE_SIZE, SOURCE_SIZE);

  const bits36 =
    bayer === 0
      ? applyThresholdTo36x36(imageData, threshold)
      : applyBayerTo36x36(imageData, threshold, bayer);

  const framed = place36IntoFrame(bits36, frame);

  return {
    bits: invert ? invertBits(framed.bits) : framed.bits,
    size: framed.size,
  };
}

function parseStickerJson(text: string): StickerData | null {
  try {
    const parsed = JSON.parse(text) as StickerData;

    if (
      !parsed ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number" ||
      !Array.isArray(parsed.pixels)
    ) {
      return null;
    }

    if (parsed.pixels.length !== parsed.height) {
      return null;
    }

    for (const row of parsed.pixels) {
      if (typeof row !== "string" || row.length !== parsed.width) {
        return null;
      }
      if (!/^[012]+$/.test(row)) {
        return null;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

function applySticker(
  baseBits: Uint8Array,
  baseSize: number,
  sticker: StickerData | null,
  stickerX: number,
  stickerY: number,
  invert: boolean
) {
  if (!sticker) return baseBits;

  const out = new Uint8Array(baseBits);

  for (let y = 0; y < sticker.height; y++) {
    for (let x = 0; x < sticker.width; x++) {
      const value = sticker.pixels[y][x];
      if (value === "0") continue;

      const targetX = stickerX + x;
      const targetY = stickerY + y;

      if (
        targetX < 0 ||
        targetY < 0 ||
        targetX >= baseSize ||
        targetY >= baseSize
      ) {
        continue;
      }

      if (value === "1") {
        out[targetY * baseSize + targetX] = invert ? 0 : 1;
      } else if (value === "2") {
        out[targetY * baseSize + targetX] = invert ? 1 : 0;
      }
    }
  }

  return out;
}

export default function PixelViewer() {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentTokenIdRef = useRef<number | null>(null);

  const [tokenId, setTokenId] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState("1");
  const [loading, setLoading] = useState(false);

  const [threshold, setThreshold] = useState(148);
  const [bayer, setBayer] = useState(0);
  const [invert, setInvert] = useState(false);
  const [frame, setFrame] = useState(4);
  const [theme, setTheme] = useState<ThemeKey>("normie");

  const [embeddedPng, setEmbeddedPng] = useState<string | null>(null);
  const [baseRendered, setBaseRendered] = useState<{
    bits: Uint8Array;
    size: number;
  } | null>(null);

  const [previewCssSize, setPreviewCssSize] = useState(320);
  const [error, setError] = useState<string | null>(null);

  const [stickerJson, setStickerJson] = useState(`{
  "width": 8,
  "height": 5,
  "pixels": [
    "00000000",
    "01100110",
    "01222100",
    "01011100",
    "01100110"
  ]
}`);
  const [stickerX, setStickerX] = useState(0);
  const [stickerY, setStickerY] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const panelStyle: React.CSSProperties = {
    backgroundColor: "var(--pixel-surface)",
    color: "var(--pixel-on)",
    borderColor: "var(--pixel-border)",
  };

  const buttonStyle: React.CSSProperties = {
    backgroundColor: "var(--pixel-on)",
    color: "var(--pixel-off)",
    borderColor: "var(--pixel-border)",
  };

  const previewFrameStyle: React.CSSProperties = {
    backgroundColor: "var(--pixel-off)",
    borderColor: "var(--pixel-border)",
  };

  const parsedSticker = useMemo(
    () => parseStickerJson(stickerJson),
    [stickerJson]
  );

  const rendered = useMemo(() => {
    if (!baseRendered) return null;

    return {
      size: baseRendered.size,
      bits: applySticker(
        baseRendered.bits,
        baseRendered.size,
        parsedSticker,
        stickerX,
        stickerY,
        invert
      ),
    };
  }, [baseRendered, parsedSticker, stickerX, stickerY, invert]);

  const loadToken = useCallback(async (nextTokenId?: number) => {
    const id =
      nextTokenId ?? getRandomTokenId(currentTokenIdRef.current ?? undefined);

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/cc0mon/${id}`, { cache: "no-store" });

      if (!res.ok) {
        throw new Error(`CC0mon proxy failed: ${res.status}`);
      }

      const meta = await res.json();

      if (!meta.image) {
        throw new Error("CC0mon metadata missing image");
      }

      const svg = decodeSvgDataUri(meta.image);
      const png = extractEmbeddedPng(svg);

      if (!png) {
        throw new Error("Could not extract embedded PNG from CC0mon SVG");
      }

      currentTokenIdRef.current = id;
      setTokenId(id);
      setTokenInput(String(id));
      setEmbeddedPng(png);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load token";
      setError(message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleLoadSpecificToken() {
    const parsed = Number(tokenInput);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > TOTAL_TOKENS) {
      setError(`Token ID must be between 1 and ${TOTAL_TOKENS}`);
      return;
    }

    void loadToken(parsed);
  }

  useEffect(() => {
    void loadToken();
  }, [loadToken]);

  useEffect(() => {
    let cancelled = false;

    async function rebuild() {
      if (!embeddedPng) return;

      try {
        const next = await cc0monImageToBits(
          embeddedPng,
          threshold,
          bayer,
          invert,
          frame
        );

        if (!cancelled) {
          setBaseRendered(next);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to rebuild image";
          setError(message);
        }
      }
    }

    void rebuild();

    return () => {
      cancelled = true;
    };
  }, [embeddedPng, threshold, bayer, invert, frame]);

  useEffect(() => {
    if (!baseRendered || !parsedSticker) return;

    setStickerX((prev) =>
      clamp(prev, 0, Math.max(0, baseRendered.size - parsedSticker.width))
    );
    setStickerY((prev) =>
      clamp(prev, 0, Math.max(0, baseRendered.size - parsedSticker.height))
    );
  }, [baseRendered, parsedSticker]);

  useEffect(() => {
    function updatePreviewSize() {
      const wrap = previewWrapRef.current;
      const current = rendered;

      if (!wrap || !current) return;

      const natural = current.size * MAX_PREVIEW_SCALE;
      const mobileMax = Math.min(window.innerWidth - 32, 420);
      const available = Math.max(
        180,
        Math.floor(Math.min(wrap.clientWidth - 8, mobileMax))
      );

      setPreviewCssSize(Math.min(natural, available));
    }

    updatePreviewSize();
    window.addEventListener("resize", updatePreviewSize);

    return () => {
      window.removeEventListener("resize", updatePreviewSize);
    };
  }, [rendered]);

  useEffect(() => {
    if (!rendered || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const internalSize = rendered.size * MAX_PREVIEW_SCALE;

    canvas.width = internalSize;
    canvas.height = internalSize;

    ctx.imageSmoothingEnabled = false;
    drawBitmap(ctx, rendered.bits, rendered.size, internalSize);
  }, [rendered, theme]);

  function updateStickerFromPointer(clientX: number, clientY: number) {
    if (!previewCanvasRef.current || !rendered || !parsedSticker) return;

    const rect = previewCanvasRef.current.getBoundingClientRect();
    const bitmapSize = rendered.size;

    const x = Math.floor(((clientX - rect.left) / rect.width) * bitmapSize);
    const y = Math.floor(((clientY - rect.top) / rect.height) * bitmapSize);

    setStickerX(clamp(x, 0, Math.max(0, bitmapSize - parsedSticker.width)));
    setStickerY(clamp(y, 0, Math.max(0, bitmapSize - parsedSticker.height)));
  }

  function exportPng() {
    if (!rendered || !exportCanvasRef.current || !tokenId) return;

    const canvas = exportCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const exportSize = getCleanExportSize(rendered.size);

    canvas.width = exportSize;
    canvas.height = exportSize;

    ctx.imageSmoothingEnabled = false;
    drawBitmap(ctx, rendered.bits, rendered.size, exportSize);

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `cc0mon-${tokenId}-${theme}${
      invert ? "-inverse" : ""
    }-${exportSize}x${exportSize}.png`;
    a.click();
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <div className="order-2 border p-3 lg:order-1" style={panelStyle}>
          <div className="space-y-3">
            <div className="border p-2" style={panelStyle}>
              <label className="mb-2 block text-xs">TOKEN ID</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  max={TOTAL_TOKENS}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="min-w-0 flex-1 px-2 py-2 text-sm outline-none"
                />
                <button
                  onClick={handleLoadSpecificToken}
                  disabled={loading}
                  className="border px-3 py-2 text-xs disabled:opacity-50"
                  style={buttonStyle}
                >
                  LOAD
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void loadToken()}
                disabled={loading}
                className="border px-3 py-3 text-xs disabled:opacity-50"
                style={buttonStyle}
              >
                {loading ? "..." : "RANDOMIZE"}
              </button>

              <button
                onClick={exportPng}
                disabled={!rendered}
                className="border px-3 py-3 text-xs disabled:opacity-50"
                style={buttonStyle}
              >
                EXPORT
              </button>
            </div>

            <div className="border p-2 text-xs" style={panelStyle}>
              CURRENT TOKEN #{tokenId ?? "-"}
            </div>

            <label className="block space-y-2">
              <span className="text-xs">THRESHOLD: {threshold}</span>
              <input
                type="range"
                min="0"
                max="255"
                step="1"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs">BAYER: {bayer}</span>
              <input
                type="range"
                min="0"
                max="128"
                step="1"
                value={bayer}
                onChange={(e) => setBayer(Number(e.target.value))}
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs">FRAME: {frame}px</span>
              <input
                type="range"
                min="0"
                max={MAX_FRAME}
                step="1"
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label
                className="flex items-center gap-3 border p-2 text-xs"
                style={panelStyle}
              >
                <input
                  type="checkbox"
                  checked={invert}
                  onChange={(e) => setInvert(e.target.checked)}
                  className="pixel-checkbox"
                />
                <span>INVERSE</span>
              </label>

              <button
                onClick={() =>
                  setTheme((prev) => (prev === "normie" ? "eth" : "normie"))
                }
                className="border px-3 py-2 text-xs"
                style={buttonStyle}
              >
                THEME: {theme === "normie" ? "NORMIE" : "ETH"}
              </button>
            </div>

            {rendered && parsedSticker && (
              <>
                <label className="block space-y-2">
                  <span className="text-xs">STICKER X: {stickerX}</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0, rendered.size - parsedSticker.width)}
                    step="1"
                    value={clamp(
                      stickerX,
                      0,
                      Math.max(0, rendered.size - parsedSticker.width)
                    )}
                    onChange={(e) => setStickerX(Number(e.target.value))}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-xs">STICKER Y: {stickerY}</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0, rendered.size - parsedSticker.height)}
                    step="1"
                    value={clamp(
                      stickerY,
                      0,
                      Math.max(0, rendered.size - parsedSticker.height)
                    )}
                    onChange={(e) => setStickerY(Number(e.target.value))}
                  />
                </label>
              </>
            )}

            {error && (
              <div className="border p-2 text-xs" style={panelStyle}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="order-1 border p-3 lg:order-2" style={panelStyle}>
          <div className="mb-3 text-center text-sm">
            PREVIEW · {THEMES[theme].name}
          </div>

          <div
            ref={previewWrapRef}
            className="flex w-full items-center justify-center overflow-hidden"
          >
            <canvas
              ref={previewCanvasRef}
              onPointerDown={(e) => {
                e.preventDefault();
                updateStickerFromPointer(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if ((e.buttons & 1) !== 1) return;
                e.preventDefault();
                updateStickerFromPointer(e.clientX, e.clientY);
              }}
              className="border"
              style={{
                ...previewFrameStyle,
                width: `${previewCssSize}px`,
                height: `${previewCssSize}px`,
                maxWidth: "100%",
                aspectRatio: "1 / 1",
                imageRendering: "pixelated",
                display: "block",
                touchAction: "none",
                cursor: parsedSticker ? "grab" : "default",
              }}
            />
          </div>
        </div>

        <div className="order-3 space-y-4 lg:max-w-[320px]">
          <StickerEditor
            initialWidth={8}
            initialHeight={5}
            theme={theme}
            onExport={(json) => setStickerJson(json)}
          />
        </div>
      </div>

      <canvas ref={exportCanvasRef} className="hidden" />
    </div>
  );
}