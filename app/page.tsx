import PixelViewer from "@/components/PixelViewer";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#e3e5e4] p-4 sm:p-6 md:p-8">
      <div className="mb-4">
        <a
          href="https://x.com/0xfilter8"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          tool by 0xfitler8
        </a>
      </div>

      <h1 className="mb-6 text-2xl sm:mb-8 sm:text-3xl">CC0MON 1-BIT</h1>
      <PixelViewer />
    </main>
  );
}