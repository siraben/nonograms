import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const svgPath = path.join(root, "public", "og.svg");
const outPath = path.join(root, "public", "og.png");

const svg = fs.readFileSync(svgPath);
await sharp(svg, { density: 144 }).png().resize(1200, 630).toFile(outPath);
console.log("wrote", outPath);

