import PixelViewer from "@/components/PixelViewer";

export default function Home() {
  return (
    <main className="pixel-page p-4 sm:p-6 md:p-8">
      <div className="mb-4">
        <a
          href="https://x.com/0xfilter8"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          tool by 0xfilter8
        </a>
      </div>

      <h1 className="mb-6 text-2xl sm:mb-8 sm:text-3xl">MONOMON</h1>

      <PixelViewer />
    </main>
  );
}