"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeSvgDataUri } from "@/lib/svg-utils";

const TOTAL_TOKENS = 10000;
const TARGET_EXPORT_SIZE = 720;
const SOURCE_SIZE = 36;
const MAX_FRAME = 12;
const DEFAULT_PREVIEW_SCALE = 10;
const MIN_PREVIEW_SCALE = 6;
const MAX_PREVIEW_SCALE = 24;

const THEMES = {
  normie: { name: "Normie" },
  eth: { name: "Eth" },
} as const;

type ThemeKey = keyof typeof THEMES;
type EditMode = "move" | "draw-dark" | "draw-light" | "erase";

type OverlayData = {
  size: number;
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
      border: "#48494b",
      oppositeOn: "#5a6da8",
    };
  }

  const styles = getComputedStyle(document.documentElement);
  const currentTheme = document.documentElement.dataset.theme as ThemeKey | undefined;

  return {
    on: styles.getPropertyValue("--pixel-on").trim() || "#48494b",
    off: styles.getPropertyValue("--pixel-off").trim() || "#e3e5e4",
    border: styles.getPropertyValue("--pixel-border").trim() || "#48494b",
    oppositeOn: currentTheme === "eth" ? "#48494b" : "#5a6da8",
  };
}

function makeOverlay(size: number): OverlayData {
  return {
    size,
    pixels: Array.from({ length: size }, () => "0".repeat(size)),
  };
}

function resizeOverlay(prev: OverlayData | null, size: number): OverlayData {
  if (!prev) return makeOverlay(size);
  if (prev.size === size) return prev;

  const pixels = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => prev.pixels[y]?.[x] ?? "0").join("")
  );

  return { size, pixels };
}

function setOverlayCell(
  overlay: OverlayData,
  x: number,
  y: number,
  value: "0" | "1" | "2"
): OverlayData {
  if (x < 0 || y < 0 || x >= overlay.size || y >= overlay.size) {
    return overlay;
  }

  const row = overlay.pixels[y];
  if (!row) return overlay;
  if (row[x] === value) return overlay;

  const nextRow = `${row.slice(0, x)}${value}${row.slice(x + 1)}`;
  const nextPixels = overlay.pixels.slice();
  nextPixels[y] = nextRow;

  return {
    ...overlay,
    pixels: nextPixels,
  };
}

function clearOverlay(overlay: OverlayData): OverlayData {
  return makeOverlay(overlay.size);
}

function invertOverlay(overlay: OverlayData): OverlayData {
  return {
    ...overlay,
    pixels: overlay.pixels.map((row) =>
      row
        .split("")
        .map((value) => (value === "1" ? "2" : value === "2" ? "1" : "0"))
        .join("")
    ),
  };
}

function shiftOverlay(overlay: OverlayData, dx: number, dy: number): OverlayData {
  if (dx === 0 && dy === 0) return overlay;

  const size = overlay.size;
  const next = makeOverlay(size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sourceX = x - dx;
      const sourceY = y - dy;

      if (
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX >= size ||
        sourceY >= size
      ) {
        continue;
      }

      const value = overlay.pixels[sourceY]?.[sourceX] ?? "0";
      if (value === "0") continue;

      next.pixels[y] =
        next.pixels[y].slice(0, x) +
        value +
        next.pixels[y].slice(x + 1);
    }
  }

  return next;
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

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: OverlayData,
  canvasSize: number,
  editMode: EditMode,
  showGrid: boolean,
  invert: boolean
) {
  const colors = getThemeColors();
  const scale = canvasSize / overlay.size;
  const darkColor = editMode === "move" ? colors.on : colors.oppositeOn;
  const lightColor = colors.off;

  for (let y = 0; y < overlay.size; y++) {
    for (let x = 0; x < overlay.size; x++) {
      const value = overlay.pixels[y]?.[x];
      if (!value || value === "0") continue;

      let fillColor = darkColor;

      if (value === "1") {
        fillColor = invert ? lightColor : darkColor;
      } else if (value === "2") {
        fillColor = invert ? darkColor : lightColor;
      }

      ctx.fillStyle = fillColor;
      ctx.fillRect(
        Math.round(x * scale),
        Math.round(y * scale),
        Math.ceil(scale),
        Math.ceil(scale)
      );
    }
  }

  if (!showGrid) return;

  ctx.strokeStyle = editMode === "move" ? colors.border : colors.oppositeOn;
  ctx.lineWidth = 1;

  for (let y = 0; y <= overlay.size; y++) {
    const py = Math.round(y * scale);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(canvasSize, py);
    ctx.stroke();
  }

  for (let x = 0; x <= overlay.size; x++) {
    const px = Math.round(x * scale);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, canvasSize);
    ctx.stroke();
  }
}

function applyOverlayToBits(
  baseBits: Uint8Array,
  baseSize: number,
  overlay: OverlayData,
  invert: boolean
) {
  const out = new Uint8Array(baseBits);

  for (let y = 0; y < Math.min(baseSize, overlay.size); y++) {
    for (let x = 0; x < Math.min(baseSize, overlay.size); x++) {
      const value = overlay.pixels[y]?.[x];
      if (!value || value === "0") continue;

      if (value === "1") {
        out[y * baseSize + x] = invert ? 0 : 1;
      } else if (value === "2") {
        out[y * baseSize + x] = invert ? 1 : 0;
      }
    }
  }

  return out;
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

export default function PixelViewer() {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentTokenIdRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const moveStartCellRef = useRef<{ x: number; y: number } | null>(null);
  const moveAppliedRef = useRef<{ dx: number; dy: number } | null>(null);

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

  const [overlay, setOverlay] = useState<OverlayData | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("draw-dark");
  const [showGrid, setShowGrid] = useState(false);
  const [previewScale, setPreviewScale] = useState(DEFAULT_PREVIEW_SCALE);

  const [previewCssSize, setPreviewCssSize] = useState(320);
  const [error, setError] = useState<string | null>(null);

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

  const inactiveButtonStyle: React.CSSProperties = {
    backgroundColor: "var(--pixel-surface)",
    color: "var(--pixel-on)",
    borderColor: "var(--pixel-border)",
  };

  const previewFrameStyle: React.CSSProperties = {
    backgroundColor: "var(--pixel-off)",
    borderColor: "var(--pixel-border)",
  };

  const rendered = useMemo(() => {
    if (!baseRendered || !overlay) return null;

    return {
      size: baseRendered.size,
      bits: applyOverlayToBits(baseRendered.bits, baseRendered.size, overlay, invert),
    };
  }, [baseRendered, overlay, invert]);

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
          setOverlay((prev) => resizeOverlay(prev, next.size));
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
    function updatePreviewSize() {
      const wrap = previewWrapRef.current;
      const current = baseRendered;

      if (!wrap || !current) return;

      const natural = current.size * previewScale;
      const mobileMax = Math.min(window.innerWidth - 32, 800);
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
  }, [baseRendered, previewScale]);

  useEffect(() => {
    if (!baseRendered || !overlay || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const internalSize = baseRendered.size * previewScale;

    canvas.width = internalSize;
    canvas.height = internalSize;

    ctx.imageSmoothingEnabled = false;
    drawBitmap(ctx, baseRendered.bits, baseRendered.size, internalSize);
    drawOverlay(ctx, overlay, internalSize, editMode, showGrid, invert);
  }, [baseRendered, overlay, editMode, showGrid, theme, invert, previewScale]);

  function getBitmapCellFromPointer(clientX: number, clientY: number) {
    if (!previewCanvasRef.current || !baseRendered) return null;

    const rect = previewCanvasRef.current.getBoundingClientRect();
    const bitmapSize = baseRendered.size;

    const x = Math.floor(((clientX - rect.left) / rect.width) * bitmapSize);
    const y = Math.floor(((clientY - rect.top) / rect.height) * bitmapSize);

    if (x < 0 || y < 0 || x >= bitmapSize || y >= bitmapSize) return null;

    return { x, y };
  }

  function paintAt(clientX: number, clientY: number) {
    const cell = getBitmapCellFromPointer(clientX, clientY);
    if (!cell || !overlay) return;

    const nextValue: "0" | "1" | "2" =
      editMode === "draw-dark"
        ? "1"
        : editMode === "draw-light"
        ? "2"
        : "0";

    setOverlay((prev) =>
      prev ? setOverlayCell(prev, cell.x, cell.y, nextValue) : prev
    );
  }

  function beginMove(clientX: number, clientY: number) {
    const cell = getBitmapCellFromPointer(clientX, clientY);
    if (!cell) return;

    moveStartCellRef.current = cell;
    moveAppliedRef.current = { dx: 0, dy: 0 };
  }

  function continueMove(clientX: number, clientY: number) {
    const cell = getBitmapCellFromPointer(clientX, clientY);
    const startCell = moveStartCellRef.current;
    const applied = moveAppliedRef.current;

    if (!cell || !startCell || !applied) return;

    const totalDx = cell.x - startCell.x;
    const totalDy = cell.y - startCell.y;

    const stepDx = totalDx - applied.dx;
    const stepDy = totalDy - applied.dy;

    if (stepDx === 0 && stepDy === 0) return;

    setOverlay((prev) => (prev ? shiftOverlay(prev, stepDx, stepDy) : prev));
    moveAppliedRef.current = { dx: totalDx, dy: totalDy };
  }

  function endMove() {
    moveStartCellRef.current = null;
    moveAppliedRef.current = null;
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
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
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

            <label className="block space-y-2">
              <span className="text-xs">ZOOM: {previewScale}x</span>
              <input
                type="range"
                min={MIN_PREVIEW_SCALE}
                max={MAX_PREVIEW_SCALE}
                step="1"
                value={previewScale}
                onChange={(e) => setPreviewScale(Number(e.target.value))}
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

            <div className="border p-2" style={panelStyle}>
              <div className="mb-2 text-xs">TOOLS</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setEditMode("move")}
                  className="border px-3 py-2 text-xs"
                  style={editMode === "move" ? buttonStyle : inactiveButtonStyle}
                >
                  MOVE
                </button>

                <button
                  onClick={() => setShowGrid((prev) => !prev)}
                  className="border px-3 py-2 text-xs"
                  style={showGrid ? buttonStyle : inactiveButtonStyle}
                >
                  GRID: {showGrid ? "ON" : "OFF"}
                </button>

                <button
                  onClick={() => setEditMode("draw-dark")}
                  className="border px-3 py-2 text-xs"
                  style={editMode === "draw-dark" ? buttonStyle : inactiveButtonStyle}
                >
                  DARK
                </button>

                <button
                  onClick={() => setEditMode("draw-light")}
                  className="border px-3 py-2 text-xs"
                  style={editMode === "draw-light" ? buttonStyle : inactiveButtonStyle}
                >
                  LIGHT
                </button>

                <button
                  onClick={() => setEditMode("erase")}
                  className="border px-3 py-2 text-xs"
                  style={editMode === "erase" ? buttonStyle : inactiveButtonStyle}
                >
                  ERASE
                </button>

                <button
                  onClick={() => setOverlay((prev) => (prev ? invertOverlay(prev) : prev))}
                  className="border px-3 py-2 text-xs"
                  style={buttonStyle}
                >
                  INVERT DRAW
                </button>

                <button
                  onClick={() => setOverlay((prev) => (prev ? clearOverlay(prev) : prev))}
                  className="border px-3 py-2 text-xs"
                  style={buttonStyle}
                >
                  CLEAR DRAW
                </button>
              </div>
            </div>

            {error && (
              <div className="border p-2 text-xs" style={panelStyle}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="order-1 border p-3 lg:order-2" style={panelStyle}>
          <div className="mb-3 text-center text-sm">
            PREVIEW · {THEMES[theme].name} ·{" "}
            {editMode === "move"
              ? "MOVE"
              : editMode === "draw-dark"
              ? "DRAW DARK"
              : editMode === "draw-light"
              ? "DRAW LIGHT"
              : "ERASE"}
          </div>

          <div
            ref={previewWrapRef}
            className="flex w-full items-center justify-center overflow-auto"
          >
            <canvas
              ref={previewCanvasRef}
              onPointerDown={(e) => {
                e.preventDefault();
                pointerIdRef.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);

                if (editMode === "move") {
                  beginMove(e.clientX, e.clientY);
                } else {
                  paintAt(e.clientX, e.clientY);
                }
              }}
              onPointerMove={(e) => {
                if (pointerIdRef.current !== e.pointerId) return;
                e.preventDefault();

                if (editMode === "move") {
                  continueMove(e.clientX, e.clientY);
                } else {
                  paintAt(e.clientX, e.clientY);
                }
              }}
              onPointerUp={(e) => {
                if (pointerIdRef.current !== e.pointerId) return;
                pointerIdRef.current = null;
                endMove();

                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              onPointerCancel={(e) => {
                if (pointerIdRef.current !== e.pointerId) return;
                pointerIdRef.current = null;
                endMove();

                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              className="border"
              style={{
                ...previewFrameStyle,
                width: `${previewCssSize}px`,
                height: `${previewCssSize}px`,
                maxWidth: "none",
                aspectRatio: "1 / 1",
                imageRendering: "pixelated",
                display: "block",
                touchAction: "none",
                cursor: editMode === "move" ? "grab" : "crosshair",
              }}
            />
          </div>
        </div>
      </div>

      <canvas ref={exportCanvasRef} className="hidden" />
    </div>
  );
}