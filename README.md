# Sticky Printer Server

Node.js server for the Sticky Printer project.

## Setup

```bash
npm install
```

## Run

```bash
npm start
```


## Windows compatibility

This project can run on Windows, but USB printer access needs one-time setup:

- Install a supported Node.js LTS version (Node 20+ recommended).
- Install dependencies with `npm install`.
- Start with `npm start` (uses `node server.js`).
- If USB access fails, bind the printer USB interface to a libusb-compatible driver (for example, WinUSB with Zadig) so the `usb` package can open it.

### Device selection behavior

- The server always matches by `USB_VENDOR_ID` + `USB_PRODUCT_ID`.
- On Linux and macOS, printer-class USB discovery is used when available.
- On Windows, some printers expose vendor-specific interfaces instead of printer class; the server now falls back to scanning all USB devices and still matches by VID/PID.
- If multiple devices share the same VID/PID, also set `USB_BUS_NUMBER` and `USB_DEVICE_ADDRESS` when your platform provides stable values.

## Notes

- `node_modules/` is ignored via `.gitignore` and will not be committed.
- USB printer selection defaults to Epson `VID=0x04b8` and `PID=0x0202`.
- A default built-in logo is automatically written to `logo.png` on first start, so logo upload is optional.
- If multiple devices share the same VID/PID, set `USB_BUS_NUMBER` and `USB_DEVICE_ADDRESS` to target the correct printer.

## Data example

```
{
  "template": "cup",
  "customer": "Tommy James",
  "item": "Refresher",
  "mods": [
    "Sweetness: reg",
    "Ice: reg",
    "Blueberry (reg)",
    "w/ lemonade (reg)",
    "w/ cold foam (lite)"
  ]
}
