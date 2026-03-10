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
