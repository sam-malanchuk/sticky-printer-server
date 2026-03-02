const express = require("express");
const escpos = require("escpos");
escpos.USB = require("./lib/escpos-usb-compat");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = 1777;
const LOGO_PATH = path.join(__dirname, "logo.png");
const LOGO_WIDTH_PX = 280; // small-medium default

let logoBuffer = null;

// --- Load logo if exists on startup ---
if (fs.existsSync(LOGO_PATH)) {
  logoBuffer = fs.readFileSync(LOGO_PATH);
}

// --- Helper: Save logo from base64 ---
async function saveLogo(base64) {
  const clean = base64.includes("base64,")
    ? base64.split("base64,")[1]
    : base64;

  const inputBuffer = Buffer.from(clean, "base64");

  const resized = await sharp(inputBuffer)
    .resize({ width: LOGO_WIDTH_PX })
    .png()
    .toBuffer();

  fs.writeFileSync(LOGO_PATH, resized);
  logoBuffer = resized;
}

// --- Print function ---
function printLabel(data) {
  return new Promise((resolve, reject) => {
    const device = new escpos.USB(0x04b8, 0x0202);
    const printer = new escpos.Printer(device);

    device.open((err) => {
      if (err) return reject(err);

      const finish = () => {
        printer.feed(2);
        printer.close();
        resolve();
      };

      try {
        // 1️⃣ Print logo first (if exists)
        if (logoBuffer) {
          escpos.Image.load(logoBuffer, (image) => {
            printer.image(image, "s8");
            printer.text("");
            printText();
          });
        } else {
          printText();
        }

        function printText() {
          printer
            .style("B")
            .size(1, 1)
            .text(data.customer || "")
            .style("NORMAL")
            .text(`${data.item || ""} x${data.qty ?? 1}`);

          if (Array.isArray(data.mods)) {
            data.mods.forEach((m) => printer.text(m));
          }

          finish();
        }
      } catch (e) {
        printer.close();
        reject(e);
      }
    });
  });
}

function renderLabelLines(payload) {
  const t = payload.template || "cup";

  if (t === "cup") {
    const lines = [];
    lines.push(payload.customer || "");
    lines.push(`${payload.item || ""} x${payload.qty ?? 1}`);
    if (Array.isArray(payload.mods)) lines.push(...payload.mods);
    return lines;
  }

  if (t === "simple") {
    return [`${payload.item || ""} x${payload.qty ?? 1}`];
  }

  // fallback
  return [
    payload.customer || "",
    payload.item || "",
    ...(Array.isArray(payload.mods) ? payload.mods : [])
  ];
}

// --- Endpoint to upload logo once ---
app.post("/logo", async (req, res) => {
  try {
    await saveLogo(req.body.base64);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Print endpoint ---
app.post("/print", async (req, res) => {
  try {
    await printLabel(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () =>
  console.log(`USB Print Server running at http://localhost:${PORT}`)
);