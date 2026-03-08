import { NextRequest, NextResponse } from "next/server";
import { filterCC0mon, getAllCC0mon, getRandomCC0mon } from "@/lib/cc0mon";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const energy = searchParams.get("energy") || undefined;
    const rarity = searchParams.get("rarity") || undefined;
    const name = searchParams.get("name") || undefined;
    const random = searchParams.get("random") === "true";

    const items = await getAllCC0mon();
    const filtered = filterCC0mon(items, { energy, rarity, name });

    if (random) {
      const picked = getRandomCC0mon(filtered);

      if (!picked) {
        return NextResponse.json(
          { error: "No CC0mon found for the selected filters" },
          { status: 404 }
        );
      }

      return NextResponse.json(picked);
    }

    return NextResponse.json({
      total: filtered.length,
      items: filtered,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load CC0mon data" },
      { status: 500 }
    );
  }
}