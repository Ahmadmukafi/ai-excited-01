// main.ts — entry program for ai-excited-01 (Node 22, standard library only).
// Copies the finished artwork (art.png, generated deterministically by
// draw.mjs) byte-for-byte to $MAKEFUN_OUTPUT_DIR/entry.png.
// No network access. Never deletes the output directory.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const here = dirname(fileURLToPath(import.meta.url));
const art = readFileSync(join(here, "art.png"));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), art);
