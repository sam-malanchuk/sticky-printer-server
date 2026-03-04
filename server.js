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
const LOGO_WIDTH_PX = 280; // fallback for smaller printers
const USB_VENDOR_ID = Number(process.env.USB_VENDOR_ID || 0x04b8);
const USB_PRODUCT_ID = Number(process.env.USB_PRODUCT_ID || 0x0202);
const USB_BUS_NUMBER = Number(process.env.USB_BUS_NUMBER || 0);
const USB_DEVICE_ADDRESS = Number(process.env.USB_DEVICE_ADDRESS || 0);
// Printer settings (tune these)
const PRINT_WIDTH_DOTS = Number(process.env.PRINT_WIDTH_DOTS || 384); // try 384 or 576
const LOGO_MAX_WIDTH_DOTS = Number(process.env.LOGO_MAX_WIDTH_DOTS || Math.min(PRINT_WIDTH_DOTS - 16, LOGO_WIDTH_PX));
const LOGO_MAX_HEIGHT_DOTS = Number(process.env.LOGO_MAX_HEIGHT_DOTS || Math.floor(LOGO_MAX_WIDTH_DOTS * 0.45));
const LOGO_SCALE = Number(process.env.LOGO_SCALE || 0.9);
let logoBuffer = null;

function getLogoBounds() {
  const safeScale = Number.isFinite(LOGO_SCALE) && LOGO_SCALE > 0 ? LOGO_SCALE : 1;
  return {
    width: Math.max(1, Math.floor(LOGO_MAX_WIDTH_DOTS * safeScale)),
    height: Math.max(1, Math.floor(LOGO_MAX_HEIGHT_DOTS * safeScale))
  };
}

async function processLogoBuffer(inputBuffer) {
  const { width, height } = getLogoBounds();
  return sharp(inputBuffer)
    .resize({
      width,
      height,
      fit: "inside",
      withoutEnlargement: true
    })
    .flatten({ background: "#ffffff" }) // remove transparency
    .grayscale()
    .threshold(180) // tune 140-210 if needed
    .png()
    .toBuffer();
}

async function refreshLogoFromDisk() {
  if (!fs.existsSync(LOGO_PATH)) return;
  const current = fs.readFileSync(LOGO_PATH);
  const processed = await processLogoBuffer(current);
  fs.writeFileSync(LOGO_PATH, processed);
  logoBuffer = processed;
}

// --- Helper: Save logo from base64 ---
async function saveLogo(base64) {
  const clean = base64.includes("base64,")
    ? base64.split("base64,")[1]
    : base64;

  const inputBuffer = Buffer.from(clean, "base64");
  const resized = await processLogoBuffer(inputBuffer);

  fs.writeFileSync(LOGO_PATH, resized);
  logoBuffer = resized;
}

// --- Print function ---
function printLabel(data) {
  return new Promise((resolve, reject) => {
    const device = createUsbDevice();
    const printer = new escpos.Printer(device);

    device.open((err) => {
      if (err) return reject(err);

      const finish = () => {
        printer.feed(2);
        printer.close();
        resolve();
      };

      try {
        if (fs.existsSync(LOGO_PATH)) {
          escpos.Image.load(LOGO_PATH, (image) => {
            printer.align("CT");
            printer.image(image, "d8");
            printer.align("LT");
            printer.feed(1);

            printByTemplate(printer, data);
            printer.feed(1);
            printer.feed(1);
            printer.cut();
            printer.feed(1);
            printer.feed(1);
            printer.feed(1);
            finish();
          });
        } else {
          printByTemplate(printer, data);
          finish();
        }
      } catch (e) {
        try { printer.close(); } catch {}
        reject(e);
      }
    });
  });
}

function createUsbDevice() {
  const printers = typeof escpos.USB.findPrinter === "function"
    ? escpos.USB.findPrinter()
    : [];

  const matchingVidPid = printers.filter((usbDevice) => {
    const descriptor = usbDevice.deviceDescriptor || {};
    return (
      descriptor.idVendor === USB_VENDOR_ID &&
      descriptor.idProduct === USB_PRODUCT_ID
    );
  });

  const matchingAddress =
    USB_BUS_NUMBER > 0 && USB_DEVICE_ADDRESS > 0
      ? matchingVidPid.find(
          (usbDevice) =>
            usbDevice.busNumber === USB_BUS_NUMBER &&
            usbDevice.deviceAddress === USB_DEVICE_ADDRESS
        )
      : null;

  if (matchingAddress) {
    return new escpos.USB(matchingAddress);
  }

  if (matchingVidPid.length > 0) {
    return new escpos.USB(matchingVidPid[0]);
  }

  return new escpos.USB(USB_VENDOR_ID, USB_PRODUCT_ID);
}

function printByTemplate(printer, data) {
  const t = data.template || "cup";

  // choose line width based on printer width
  const cols = PRINT_WIDTH_DOTS >= 560 ? 48 : 32;

  if (t === "cup") {
    printer.align("CT").style("B").size(2, 2);
    printWrapped(printer, data.customer || "", cols);
    printer.size(1, 1).style("NORMAL");

    sep(printer, "-", cols);

    printer.align("LT").style("B");
    printWrapped(printer, `${data.item || ""} x${data.qty ?? 1}`, cols);
    printer.style("NORMAL");

    if (Array.isArray(data.mods) && data.mods.length) {
      printer.feed(1);
      printMods(printer, data.mods, cols);
    }

    if (data.note) {
      printer.feed(1);
      printer.align("LT").style("B").text("NOTE:");
      printer.style("NORMAL");
      printWrapped(printer, data.note, cols);
    }

    printer.feed(1);
    return;
  }

  if (t === "kitchen") {
    printer.align("CT").style("B").size(2, 2);
    printWrapped(printer, data.item || "", cols);
    printer.size(1, 1);

    printer.align("LT").style("B");
    printer.text(`QTY: ${data.qty ?? 1}`);
    printer.text(`NAME: ${data.customer || ""}`);
    printer.style("NORMAL");

    sep(printer, "=", cols);

    if (Array.isArray(data.mods) && data.mods.length) {
      printer.style("B").text("MODS:");
      printer.style("NORMAL");
      printMods(printer, data.mods, cols);
    }

    if (data.instructions) {
      printer.feed(1);
      printer.style("B").text("INSTRUCTIONS:");
      printer.style("NORMAL");
      printWrapped(printer, data.instructions, cols);
    }

    printer.feed(1);
    return;
  }

  if (t === "simple") {
    printer.align("LT").style("B");
    printWrapped(printer, `${data.item || ""} x${data.qty ?? 1}`, cols);
    printer.style("NORMAL");
    if (data.customer) printWrapped(printer, data.customer, cols);
    if (Array.isArray(data.mods)) printMods(printer, data.mods, cols);
    printer.feed(1);
    return;
  }

  // fallback
  printer.align("LT");
  printWrapped(printer, JSON.stringify(data), cols);
  printer.feed(1);
}

function sep(printer, ch = "-", count = 32) {
  printer.text(ch.repeat(count));
}

function wrapLine(s, max = 32) {
  const str = String(s ?? "");
  const out = [];
  let i = 0;
  while (i < str.length) {
    out.push(str.slice(i, i + max));
    i += max;
  }
  return out.length ? out : [""];
}

function printWrapped(printer, text, max = 32) {
  wrapLine(text, max).forEach((l) => printer.text(l));
}

function printMods(printer, mods = [], max = 32) {
  mods.forEach((m) => printWrapped(printer, `- ${m}`, max));
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

refreshLogoFromDisk()
  .catch((e) => {
    console.error("Failed to normalize existing logo:", e.message);
  })
  .finally(() => {
    app.listen(PORT, () =>
      console.log(`USB Print Server running at http://localhost:${PORT}`)
    );
  });
