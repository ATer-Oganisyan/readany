const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const appRoot = path.resolve(__dirname, "..");
const assetsRoot = path.join(appRoot, "assets");
const layersRoot = path.join(assetsRoot, "app-icon-layers");
const iconRoot = path.join(assetsRoot, "Narra.icon");
const iconAssetsRoot = path.join(iconRoot, "Assets");

const bookSource = path.join(layersRoot, "01-book.svg");
const characterSource = path.join(layersRoot, "02-character.svg");

function readSvgBody(filePath) {
  const svg = fs.readFileSync(filePath, "utf8");
  const match = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!match) {
    throw new Error(`Не удалось прочитать SVG: ${filePath}`);
  }
  return match[1].trim();
}

function opacityFor(appearance) {
  if (appearance === "default") {
    return [{ value: 1 }, { appearance: "dark", value: 0 }, { appearance: "tinted", value: 0 }];
  }

  if (appearance === "dark") {
    return [{ value: 0 }, { appearance: "dark", value: 1 }, { appearance: "tinted", value: 0 }];
  }

  return [{ value: 0 }, { appearance: "tinted", value: 1 }];
}

function artworkLayers(imageName, darkImageName, name) {
  return [
    {
      glass: false,
      hidden: false,
      "image-name": imageName,
      name: `${name} · Light`,
      "opacity-specializations": opacityFor("default"),
    },
    {
      glass: false,
      hidden: false,
      "image-name": darkImageName,
      name: `${name} · Dark`,
      "opacity-specializations": opacityFor("dark"),
    },
    {
      "blend-mode-specializations": [
        { value: "normal" },
        { appearance: "tinted", value: "screen" },
      ],
      fill: "automatic",
      glass: false,
      hidden: false,
      "image-name": imageName,
      name: `${name} · Tinted`,
      "opacity-specializations": opacityFor("tinted"),
    },
  ];
}

function group(name, imageName, darkImageName) {
  return {
    hidden: false,
    layers: artworkLayers(imageName, darkImageName, name),
    name: name,
    shadow: {
      kind: "neutral",
      opacity: 0.24,
    },
    translucency: {
      enabled: false,
      value: 0.2,
    },
  };
}

async function main() {
  fs.mkdirSync(iconAssetsRoot, { recursive: true });

  const bookBody = readSvgBody(bookSource);
  const characterBody = readSvgBody(characterSource);

  fs.copyFileSync(bookSource, path.join(iconAssetsRoot, "01-book.svg"));
  fs.copyFileSync(characterSource, path.join(iconAssetsRoot, "02-character.svg"));
  fs.writeFileSync(
    path.join(iconAssetsRoot, "01-book-dark.svg"),
    fs.readFileSync(bookSource, "utf8").replaceAll("#A1A1A1", "#D9D9D9"),
  );
  fs.writeFileSync(
    path.join(iconAssetsRoot, "02-character-dark.svg"),
    fs.readFileSync(characterSource, "utf8").replaceAll("#A1A1A1", "#D9D9D9"),
  );

  const darkBackground = `<svg width="1024" height="1024" viewBox="0 0 250 250" xmlns="http://www.w3.org/2000/svg">
  <rect width="250" height="250" fill="#111111"/>
</svg>\n`;
  fs.writeFileSync(path.join(iconAssetsRoot, "00-dark-background.svg"), darkBackground);

  const iconDocument = {
    features: ["refractivity"],
    fill: {
      solid: "extended-srgb:1.00000,1.00000,1.00000,1.00000",
    },
    // Icon Composer stores the frontmost group first.
    groups: [
      group("Character", "02-character.svg", "02-character-dark.svg"),
      group("Book", "01-book.svg", "01-book-dark.svg"),
      {
        hidden: false,
        layers: [
          {
            glass: false,
            hidden: false,
            "image-name": "00-dark-background.svg",
            name: "Dark background",
            "opacity-specializations": opacityFor("dark"),
          },
        ],
        name: "Background",
        translucency: {
          enabled: false,
          value: 0,
        },
      },
    ],
    "supported-platforms": {
      circles: ["watchOS"],
      squares: "shared",
    },
  };

  fs.writeFileSync(path.join(iconRoot, "icon.json"), `${JSON.stringify(iconDocument, null, 2)}\n`);

  const combinedArtwork = `${bookBody}\n${characterBody}`;
  const legacySvg = `<svg width="1024" height="1024" viewBox="0 0 250 250" xmlns="http://www.w3.org/2000/svg">
  <rect width="250" height="250" fill="#FFFFFF"/>
  ${combinedArtwork}
</svg>\n`;
  const adaptiveSvg = `<svg width="432" height="432" viewBox="0 0 250 250" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(40 40) scale(0.68)">
    ${combinedArtwork}
  </g>
</svg>\n`;
  const monochromeSvg = adaptiveSvg.replaceAll("#A1A1A1", "#000000");
  const splashLogoSvg = adaptiveSvg.replace(
    'width="432" height="432"',
    'width="1024" height="1024"',
  );
  const splashLogoDarkSvg = splashLogoSvg.replaceAll("#A1A1A1", "#D9D9D9");
  const splashSvg = `<svg width="512" height="512" viewBox="0 0 250 250" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="splash-icon-mask">
      <rect width="250" height="250" rx="56"/>
    </clipPath>
  </defs>
  <g clip-path="url(#splash-icon-mask)">
    <rect width="250" height="250" fill="#FFFFFF"/>
    ${combinedArtwork}
  </g>
</svg>\n`;

  fs.writeFileSync(path.join(assetsRoot, "adaptive-icon.svg"), adaptiveSvg);
  fs.writeFileSync(path.join(assetsRoot, "adaptive-icon-monochrome.svg"), monochromeSvg);
  fs.writeFileSync(path.join(assetsRoot, "splash-logo.svg"), splashLogoSvg);
  fs.writeFileSync(path.join(assetsRoot, "splash-logo-dark.svg"), splashLogoDarkSvg);

  await sharp(Buffer.from(legacySvg)).png().toFile(path.join(assetsRoot, "icon.png"));
  await sharp(Buffer.from(adaptiveSvg)).png().toFile(path.join(assetsRoot, "adaptive-icon.png"));
  await sharp(Buffer.from(monochromeSvg))
    .png()
    .toFile(path.join(assetsRoot, "adaptive-icon-monochrome.png"));
  await sharp(Buffer.from(splashLogoSvg)).png().toFile(path.join(assetsRoot, "splash-logo.png"));
  await sharp(Buffer.from(splashLogoDarkSvg))
    .png()
    .toFile(path.join(assetsRoot, "splash-logo-dark.png"));
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(assetsRoot, "splash-icon.png"));

  process.stdout.write("Готово: iOS .icon и Android adaptive/monochrome assets созданы.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
