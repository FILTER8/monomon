# CC0MON 1-BIT

A mobile-friendly pixel tool for **CC0MON** built with **Next.js**.

It lets you load any CC0MON token, convert it into a clean two-color pixel output, and customize it with:

- Threshold
- Bayer dithering
- Invert
- Adjustable frame
- Grid-snapped sticker placement
- Sticker editor with transparent / dark / light pixels
- Clean pixel-perfect PNG export

## CC0

This project is made in the spirit of **CC0** and remix culture.

Built with love for onchain pixel art, open experiments, and playful tooling.

## Links

- Creator: [0xfitler8 on X](https://x.com/0xfilter8)
- CC0MON: [@cc0_mon on X](https://x.com/cc0_mon)
- CC0MON API: [api.cc0mon.com](https://api.cc0mon.com/)
- Next.js: [nextjs.org](https://nextjs.org)

## Features

- Load a random CC0MON token
- Load a specific token by ID
- Convert the artwork into a two-color bitmap
- Use the **Normies** palette:
  - Dark: `#48494b`
  - Light: `#e3e5e4`
- Add a frame around the artwork
- Create custom stickers directly in the browser
- Place stickers on the artwork with grid-perfect positioning
- Export a clean PNG with integer scaling
- Mobile-friendly app layout

## Tech Stack

- [Next.js](https://nextjs.org)
- React
- TypeScript
- App Router
- `next/font` with **Silkscreen**

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build

Create a production build:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

## Project Notes

The app fetches token metadata from the CC0MON API and renders the embedded image locally on a pixel grid.

Stickers are edited as JSON bitmap data where:

- `0` = transparent
- `1` = dark pixel
- `2` = light pixel

This keeps placement and export pixel-perfect.

## Sticker Format

Example sticker JSON:

```json
{
  "width": 8,
  "height": 5,
  "pixels": [
    "00000000",
    "01100110",
    "01222100",
    "01011100",
    "01100110"
  ]
}
```

## Deploy

You can deploy this app on platforms like:

- [Vercel](https://vercel.com/)
- Netlify
- Railway

For Vercel, the easiest path is:

1. Push the repo to GitHub
2. Import it into Vercel
3. Deploy

## Credits

Tool by [0xfitler8](https://x.com/0xfilter8)

Inspired by **CC0MON** and open pixel culture.
