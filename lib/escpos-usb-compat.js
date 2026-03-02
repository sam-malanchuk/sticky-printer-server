"use strict";

const os = require("os");
const util = require("util");
const EventEmitter = require("events");

let usb = null;

const IFACE_CLASS = {
  PRINTER: 0x07,
};

function getUsbLib() {
  if (!usb) {
    const usbModule = require("usb");
    // usb@2+ exports APIs under `usb`; usb@1 exports methods at root.
    usb = usbModule.usb || usbModule;
  }
  return usb;
}

function USB(vid, pid) {
  const usbLib = getUsbLib();

  EventEmitter.call(this);
  this.device = null;

  if (vid && pid) {
    this.device = usbLib.findByIds(vid, pid);
  } else if (vid) {
    this.device = vid;
  } else {
    const devices = USB.findPrinter();
    if (devices?.length) this.device = devices[0];
  }

  if (!this.device) {
    throw new Error("Can not find printer");
  }

  usbLib.on("detach", (device) => {
    if (device === this.device) {
      this.emit("detach", device);
      this.emit("disconnect", device);
      this.device = null;
    }
  });

  return this;
}

USB.findPrinter = function findPrinter() {
  const usbLib = getUsbLib();
  return usbLib.getDeviceList().filter((device) => {
    try {
      return device.configDescriptor.interfaces.some((iface) =>
        iface.some((conf) => conf.bInterfaceClass === IFACE_CLASS.PRINTER)
      );
    } catch (_err) {
      return false;
    }
  });
};

util.inherits(USB, EventEmitter);

USB.prototype.open = function open(callback) {
  let counter = 0;
  this.device.open();

  this.device.interfaces.forEach((iface) => {
    iface.setAltSetting(iface.altSetting, () => {
      try {
        if (os.platform() !== "win32" && iface.isKernelDriverActive()) {
          try {
            iface.detachKernelDriver();
          } catch (err) {
            console.error("[ERROR] Could not detach kernel driver: %s", err);
          }
        }

        iface.claim();
        iface.endpoints.forEach((endpoint) => {
          if (endpoint.direction === "out" && !this.endpoint) {
            this.endpoint = endpoint;
          }
        });

        if (this.endpoint) {
          this.emit("connect", this.device);
          callback?.(null, this);
        } else if (++counter === this.device.interfaces.length) {
          callback?.(new Error("Can not find endpoint from printer"));
        }
      } catch (err) {
        callback?.(err);
      }
    });
  });

  return this;
};

USB.prototype.write = function write(data, callback) {
  this.emit("data", data);
  this.endpoint.transfer(data, callback);
  return this;
};

USB.prototype.close = function close(callback) {
  const usbLib = getUsbLib();

  if (!this.device) {
    callback?.(null);
    return this;
  }

  try {
    this.device.close();
    usbLib.removeAllListeners("detach");
    callback?.(null);
    this.emit("close", this.device);
  } catch (err) {
    callback?.(err);
  }

  return this;
};

module.exports = USB;
