"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const PIXEL_DARK_HEX = "#48494b";
const PIXEL_LIGHT_HEX = "#e3e5e4";
const PREVIEW_BG_HEX = "#ffffff";

type Props = {
  initialWidth?: number;
  initialHeight?: number;
  onExport?: (json: string) => void;
};

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

export default function StickerEditor({
  initialWidth = 8,
  initialHeight = 8,
  onExport,
}: Props) {
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [baseGrid, setBaseGrid] = useState<number[][]>(() =>
    makeGrid(initialWidth, initialHeight)
  );
  const [drawValue, setDrawValue] = useState<1 | 2>(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const dragPaintValueRef = useRef<0 | 1 | 2>(1);

  const cellSize = useMemo(() => {
    const longestSide = Math.max(width, height);

    if (longestSide <= 8) return 24;
    if (longestSide <= 12) return 20;
    if (longestSide <= 16) return 16;
    if (longestSide <= 24) return 12;
    return 10;
  }, [width, height]);

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
    const canvas = canvasRef.current;
    if (!canvas) return;

    const actualHeight = grid.length;
    const actualWidth = Math.max(0, ...grid.map((row) => row.length), width);

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, actualWidth * cellSize);
    const cssHeight = Math.max(1, actualHeight * cellSize);

    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
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
          ctx.fillStyle = PIXEL_DARK_HEX;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        } else if (value === 2) {
          ctx.fillStyle = PIXEL_LIGHT_HEX;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }

        ctx.strokeStyle = PIXEL_DARK_HEX;
        ctx.lineWidth = 1;
        ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }, [grid, width, height, cellSize]);

  function getCellFromPointer(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / cellSize);
    const y = Math.floor((clientY - rect.top) / cellSize);

    if (x < 0 || y < 0 || x >= width || y >= height) return null;

    return { x, y };
  }

  function paintStart(clientX: number, clientY: number) {
    const cell = getCellFromPointer(clientX, clientY);
    if (!cell) return;

    setBaseGrid((prev) => {
      const next = resizeGrid(prev, width, height);
      const current = next[cell.y][cell.x] ?? 0;
      const nextValue: 0 | 1 | 2 = current === drawValue ? 0 : drawValue;

      dragPaintValueRef.current = nextValue;
      next[cell.y][cell.x] = nextValue;
      return next;
    });
  }

  function dragPaint(clientX: number, clientY: number) {
    const cell = getCellFromPointer(clientX, clientY);
    if (!cell) return;

    setBaseGrid((prev) => {
      const next = resizeGrid(prev, width, height);
      next[cell.y][cell.x] = dragPaintValueRef.current;
      return next;
    });
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

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <input
          type="number"
          min={1}
          max={32}
          value={width}
          onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || 1))}
          className="border bg-[#e3e5e4] px-2 py-2 text-xs outline-none"
        />
        <input
          type="number"
          min={1}
          max={32}
          value={height}
          onChange={(e) => setHeight(Math.max(1, Number(e.target.value) || 1))}
          className="border bg-[#e3e5e4] px-2 py-2 text-xs outline-none"
        />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => setDrawValue(1)}
          className="border bg-[#48494b] px-3 py-2 text-xs text-[#e3e5e4]"
        >
          DARK
        </button>
        <button
          onClick={() => setDrawValue(2)}
          className="border bg-[#48494b] px-3 py-2 text-xs text-[#e3e5e4]"
        >
          LIGHT
        </button>
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

      <div className="mb-3 overflow-auto border bg-white p-2">
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => {
            isDrawingRef.current = true;
            paintStart(e.clientX, e.clientY);
          }}
          onMouseMove={(e) => {
            if (!isDrawingRef.current) return;
            dragPaint(e.clientX, e.clientY);
          }}
          onMouseUp={() => {
            isDrawingRef.current = false;
          }}
          onMouseLeave={() => {
            isDrawingRef.current = false;
          }}
          onTouchStart={(e) => {
            isDrawingRef.current = true;
            const touch = e.touches[0];
            if (touch) paintStart(touch.clientX, touch.clientY);
          }}
          onTouchMove={(e) => {
            if (!isDrawingRef.current) return;
            const touch = e.touches[0];
            if (touch) dragPaint(touch.clientX, touch.clientY);
          }}
          onTouchEnd={() => {
            isDrawingRef.current = false;
          }}
          style={{
            imageRendering: "pixelated",
            display: "block",
            touchAction: "none",
            maxWidth: "100%",
          }}
        />
      </div>

      <div className="text-xs">
        CLICK PAINTS THE SELECTED COLOR. CLICKING THE SAME COLOR AGAIN ERASES IT.
      </div>
    </div>
  );
}