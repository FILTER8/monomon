"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const PIXEL_LIGHT_HEX = "#e3e5e4";
const PREVIEW_BG_HEX = "#ffffff";
const GRID_LINE_HEX = "#48494b";

const PALETTES = {
  normie: {
    name: "Normie",
    dark: "#48494b",
  },
  eth: {
    name: "Eth",
    dark: "#5c6fa8",
  },
} as const;

type PaletteKey = keyof typeof PALETTES;

type Props = {
  initialWidth?: number;
  initialHeight?: number;
  palette: PaletteKey;
  onExport?: (json: string) => void;
};

type Tool = 0 | 1 | 2;

function makeGrid(width: number, height: number) {
  return Array.from({ length: height }, () => Array(width).fill(0));
}

function resizeGrid(
  prev: number[][],
  nextWidth: number,
  nextHeight: number
): number[][] {
  const next = makeGrid(nextWidth, nextHeight);

  for (let y = 0; y < Math.min(prev.length, nextHeight); y++) {
    const prevRow = prev[y] ?? [];
    for (let x = 0; x < Math.min(prevRow.length, nextWidth); x++) {
      next[y][x] = prevRow[x] ?? 0;
    }
  }

  return next;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function StickerEditor({
  initialWidth = 8,
  initialHeight = 8,
  palette,
  onExport,
}: Props) {
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [baseGrid, setBaseGrid] = useState<number[][]>(() =>
    makeGrid(initialWidth, initialHeight)
  );
  const [tool, setTool] = useState<Tool>(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const dragPaintValueRef = useRef<0 | 1 | 2>(1);
  const pointerIdRef = useRef<number | null>(null);

  const [cssCellSize, setCssCellSize] = useState(24);

  const activePalette = PALETTES[palette];

  const grid = useMemo(() => {
    return resizeGrid(baseGrid, width, height);
  }, [baseGrid, width, height]);

  const exportedJson = useMemo(() => {
    const payload = {
      width,
      height,
      pixels: grid.map((row) =>
        Array.from({ length: width }, (_, x) => String(row?.[x] ?? 0)).join("")
      ),
    };

    return JSON.stringify(payload, null, 2);
  }, [width, height, grid]);

  useEffect(() => {
    onExport?.(exportedJson);
  }, [exportedJson, onExport]);

  useEffect(() => {
    function updateCellSize() {
      const wrap = wrapRef.current;
      if (!wrap) return;

      const availableWidth = Math.max(180, wrap.clientWidth - 16);
      const availableHeight = Math.min(window.innerHeight * 0.45, 420);

      const nextFromWidth = Math.floor(availableWidth / width);
      const nextFromHeight = Math.floor(availableHeight / height);
      const next = clamp(Math.min(nextFromWidth, nextFromHeight), 10, 32);

      setCssCellSize(next);
    }

    updateCellSize();
    window.addEventListener("resize", updateCellSize);

    return () => {
      window.removeEventListener("resize", updateCellSize);
    };
  }, [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const actualHeight = grid.length;
    const actualWidth = Math.max(0, ...grid.map((row) => row.length), width);

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, actualWidth * cssCellSize);
    const cssHeight = Math.max(1, actualHeight * cssCellSize);

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = PREVIEW_BG_HEX;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    for (let y = 0; y < actualHeight; y++) {
      for (let x = 0; x < actualWidth; x++) {
        const value = grid[y]?.[x] ?? 0;

        if (value === 1) {
          ctx.fillStyle = activePalette.dark;
          ctx.fillRect(
            x * cssCellSize,
            y * cssCellSize,
            cssCellSize,
            cssCellSize
          );
        } else if (value === 2) {
          ctx.fillStyle = PIXEL_LIGHT_HEX;
          ctx.fillRect(
            x * cssCellSize,
            y * cssCellSize,
            cssCellSize,
            cssCellSize
          );
        }

        ctx.strokeStyle = GRID_LINE_HEX;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          x * cssCellSize,
          y * cssCellSize,
          cssCellSize,
          cssCellSize
        );
      }
    }
  }, [grid, width, height, cssCellSize, activePalette]);

  function getCellFromPointer(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    const relativeX = (clientX - rect.left) / rect.width;
    const relativeY = (clientY - rect.top) / rect.height;

    const x = Math.floor(relativeX * width);
    const y = Math.floor(relativeY * height);

    if (x < 0 || y < 0 || x >= width || y >= height) return null;

    return { x, y };
  }

  function paintCell(x: number, y: number, value: 0 | 1 | 2) {
    setBaseGrid((prev) => {
      const next = resizeGrid(prev, width, height);
      next[y][x] = value;
      return next;
    });
  }

  function paintStart(clientX: number, clientY: number) {
    const cell = getCellFromPointer(clientX, clientY);
    if (!cell) return;

    dragPaintValueRef.current = tool;
    paintCell(cell.x, cell.y, tool);
  }

  function dragPaint(clientX: number, clientY: number) {
    const cell = getCellFromPointer(clientX, clientY);
    if (!cell) return;

    paintCell(cell.x, cell.y, dragPaintValueRef.current);
  }

  function clearAll() {
    setBaseGrid(makeGrid(width, height));
  }

  function invertAll() {
    setBaseGrid((prev) =>
      resizeGrid(prev, width, height).map((row) =>
        row.map((v) => (v === 1 ? 2 : v === 2 ? 1 : 0))
      )
    );
  }

  return (
    <div className="border bg-[#e3e5e4] p-3">
      <div className="mb-3 text-sm">STICKER EDITOR</div>

      <div className="mb-2 text-xs">PALETTE: {activePalette.name}</div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <input
          type="number"
          min={1}
          max={32}
          value={width}
          onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || 1))}
          className="border bg-[#e3e5e4] px-2 py-2 text-xs outline-none"
          aria-label="Width"
        />
        <input
          type="number"
          min={1}
          max={32}
          value={height}
          onChange={(e) => setHeight(Math.max(1, Number(e.target.value) || 1))}
          className="border bg-[#e3e5e4] px-2 py-2 text-xs outline-none"
          aria-label="Height"
        />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <button
          onClick={() => setTool(1)}
          className={`border px-3 py-2 text-xs ${
            tool === 1
              ? "bg-[#48494b] text-[#e3e5e4]"
              : "bg-[#e3e5e4] text-[#48494b]"
          }`}
        >
          DARK
        </button>

        <button
          onClick={() => setTool(2)}
          className={`border px-3 py-2 text-xs ${
            tool === 2
              ? "bg-[#48494b] text-[#e3e5e4]"
              : "bg-[#e3e5e4] text-[#48494b]"
          }`}
        >
          LIGHT
        </button>

        <button
          onClick={() => setTool(0)}
          className={`border px-3 py-2 text-xs ${
            tool === 0
              ? "bg-[#48494b] text-[#e3e5e4]"
              : "bg-[#e3e5e4] text-[#48494b]"
          }`}
        >
          ERASER
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          onClick={clearAll}
          className="border bg-[#48494b] px-3 py-2 text-xs text-[#e3e5e4]"
        >
          CLEAR
        </button>
        <button
          onClick={invertAll}
          className="border bg-[#48494b] px-3 py-2 text-xs text-[#e3e5e4]"
        >
          INVERT
        </button>
      </div>

      <div ref={wrapRef} className="mb-3 overflow-auto border bg-white p-2">
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            e.preventDefault();
            isDrawingRef.current = true;
            pointerIdRef.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            paintStart(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (!isDrawingRef.current) return;
            if (pointerIdRef.current !== e.pointerId) return;
            e.preventDefault();
            dragPaint(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            isDrawingRef.current = false;
            pointerIdRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={() => {
            isDrawingRef.current = false;
            pointerIdRef.current = null;
          }}
          style={{
            imageRendering: "pixelated",
            display: "block",
            touchAction: "none",
            maxWidth: "100%",
            margin: "0 auto",
          }}
        />
      </div>

      <div className="text-xs">
        TOOL: {tool === 1 ? "DARK" : tool === 2 ? "LIGHT" : "ERASER"} ·
        PALETTE: {activePalette.name}
      </div>
    </div>
  );
}