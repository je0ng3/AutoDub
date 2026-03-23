const https = require("https");
const fs = require("fs");
const path = require("path");

const BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
const OUT_DIR = path.join(__dirname, "../public/ffmpeg");
const FILES = [
  { name: "ffmpeg-core.js", type: "text/javascript" },
  { name: "ffmpeg-core.wasm", type: "application/wasm" },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`[ffmpeg] skip ${path.basename(dest)} (already exists)`);
      return resolve();
    }
    console.log(`[ffmpeg] downloading ${path.basename(dest)}...`);
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return download(res.headers.location, dest).then(resolve).catch(reject);
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const { name } of FILES) {
    await download(`${BASE}/${name}`, path.join(OUT_DIR, name));
  }
  console.log("[ffmpeg] done");
})();
