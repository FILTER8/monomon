export type CC0monItem = {
  number: number;
  name: string;
  energy: string;
  rarity: string;
  tokenId: number;
  svg: string;
  png: string;
};

type RegistryResponse = {
  total: number;
  cc0mon: {
    number: number;
    name: string;
    energy: string;
    rarity: string;
  }[];
};

type RegistryImagesResponse = {
  total: number;
  mapped: number;
  images: Record<
    string,
    {
      name: string;
      tokenId: number;
      svg: string;
      png: string;
    }
  >;
};

const API_BASE = "https://api.cc0mon.com";

export async function getAllCC0mon(): Promise<CC0monItem[]> {
  const [registryRes, imagesRes] = await Promise.all([
    fetch(`${API_BASE}/registry`, {
      next: { revalidate: 3600 },
    }),
    fetch(`${API_BASE}/registry/images`, {
      next: { revalidate: 3600 },
    }),
  ]);

  if (!registryRes.ok) {
    throw new Error(`Registry fetch failed: ${registryRes.status}`);
  }

  if (!imagesRes.ok) {
    throw new Error(`Images fetch failed: ${imagesRes.status}`);
  }

  const registry: RegistryResponse = await registryRes.json();
  const imageMap: RegistryImagesResponse = await imagesRes.json();

  return registry.cc0mon
    .map((item) => {
      const img = imageMap.images[String(item.number)];
      if (!img) return null;

      return {
        ...item,
        tokenId: img.tokenId,
        svg: img.svg,
        png: img.png,
      };
    })
    .filter(Boolean) as CC0monItem[];
}

export function filterCC0mon(
  items: CC0monItem[],
  filters: {
    energy?: string;
    rarity?: string;
    name?: string;
  }
) {
  return items.filter((item) => {
    const matchesEnergy = filters.energy
      ? item.energy.toLowerCase() === filters.energy.toLowerCase()
      : true;

    const matchesRarity = filters.rarity
      ? item.rarity.toLowerCase() === filters.rarity.toLowerCase()
      : true;

    const matchesName = filters.name
      ? item.name.toLowerCase().includes(filters.name.toLowerCase())
      : true;

    return matchesEnergy && matchesRarity && matchesName;
  });
}

export function getRandomCC0mon(items: CC0monItem[]) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}