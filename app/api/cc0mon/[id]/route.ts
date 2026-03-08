import { NextResponse } from "next/server";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`https://api.cc0mon.com/cc0mon/${id}/metadata`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 Next.js CC0mon Viewer",
        },
      });

      if (res.status === 429 && attempt < 2) {
        await sleep(400 * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        return NextResponse.json(
          { error: `CC0mon fetch failed: ${res.status}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json(
      { error: "CC0mon fetch failed after retries" },
      { status: 429 }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to reach CC0mon API" },
      { status: 502 }
    );
  }
}