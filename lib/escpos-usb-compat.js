"use strict";

const os = require("os");
const util = require("util");
const EventEmitter = require("events");

let usbModule = null;

const IFACE_CLASS = {
  PRINTER: 0x07,
};

const ENDPOINT_TRANSFER_TYPE = {
  BULK: 0x02,
};

function endpointTransferType(endpoint) {
  return endpoint?.descriptor?.bmAttributes & 0x03;
}

function isBulkOutEndpoint(endpoint) {
  return (
    endpoint?.direction === "out" &&
    endpointTransferType(endpoint) === ENDPOINT_TRANSFER_TYPE.BULK
  );
}

function getUsbModule() {
  if (!usbModule) {
    usbModule = require("usb");
  }
  return usbModule;
}

function getUsbApi() {
  const moduleRef = getUsbModule();
  const nestedRef = moduleRef.usb;

  return {
    findByIds:
      typeof moduleRef.findByIds === "function"
        ? moduleRef.findByIds.bind(moduleRef)
        : nestedRef && typeof nestedRef.findByIds === "function"
          ? nestedRef.findByIds.bind(nestedRef)
          : null,
    getDeviceList:
      typeof moduleRef.getDeviceList === "function"
        ? moduleRef.getDeviceList.bind(moduleRef)
        : nestedRef && typeof nestedRef.getDeviceList === "function"
          ? nestedRef.getDeviceList.bind(nestedRef)
          : null,
  };
}

function getUsbEmitter() {
  const moduleRef = getUsbModule();
  const nestedRef = moduleRef.usb;

  if (nestedRef && typeof nestedRef.on === "function") {
    return nestedRef;
  }

  if (typeof moduleRef.on === "function") {
    return moduleRef;
  }

  return null;
}

function USB(vid, pid) {
  const usbApi = getUsbApi();

  EventEmitter.call(this);
  this.device = null;

  if (vid && pid) {
    if (!usbApi.findByIds) {
      throw new Error("USB findByIds API is unavailable");
    }
    this.device = usbApi.findByIds(vid, pid);
  } else if (vid) {
    this.device = vid;
  } else {
    const devices = USB.findPrinter();
    if (devices?.length) this.device = devices[0];
  }

  if (!this.device) {
    throw new Error("Can not find printer");
  }

  const emitter = getUsbEmitter();
  if (emitter) {
    emitter.on("detach", (device) => {
      if (device === this.device) {
        this.emit("detach", device);
        this.emit("disconnect", device);
        this.device = null;
      }
    });
  }

  return this;
}

USB.findPrinter = function findPrinter() {
  const usbApi = getUsbApi();
  if (!usbApi.getDeviceList) {
    return [];
  }

  return usbApi.getDeviceList().filter((device) => {
    try {
      return device.configDescriptor.interfaces.some((iface) =>
        iface.some((conf) => conf.bInterfaceClass === IFACE_CLASS.PRINTER)
      );
    } catch (_err) {
      return false;
    }
  });
};


USB.getDeviceList = function getDeviceList() {
  const usbApi = getUsbApi();
  if (!usbApi.getDeviceList) {
    return [];
  }

  return usbApi.getDeviceList();
};

util.inherits(USB, EventEmitter);

USB.prototype.open = function open(callback) {
  let counter = 0;
  let done = false;
  this.device.open();

  const printerInterfaceNumbers = new Set(
    (this.device.configDescriptor?.interfaces || [])
      .flat()
      .filter((iface) => iface.bInterfaceClass === IFACE_CLASS.PRINTER)
      .map((iface) => iface.bInterfaceNumber)
  );

  const interfaces = this.device.interfaces || [];

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

        const bulkOutEndpoint = iface.endpoints.find(isBulkOutEndpoint);
        const fallbackOutEndpoint = iface.endpoints.find(
          (endpoint) => endpoint.direction === "out"
        );

        if (printerInterfaceNumbers.has(iface.interfaceNumber) && bulkOutEndpoint) {
          this.endpoint = bulkOutEndpoint;
        } else if (!this.endpoint && bulkOutEndpoint) {
          this.endpoint = bulkOutEndpoint;
        } else if (!this.endpoint && fallbackOutEndpoint) {
          this.endpoint = fallbackOutEndpoint;
        }

        if (this.endpoint && !done) {
          done = true;
          this.emit("connect", this.device);
          callback?.(null, this);
        } else if (!done && ++counter === interfaces.length) {
          done = true;
          callback?.(new Error("Can not find endpoint from printer"));
        }
      } catch (err) {
        if (!done) {
          done = true;
          callback?.(err);
        }
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
  const emitter = getUsbEmitter();

  if (!this.device) {
    callback?.(null);
    return this;
  }

  try {
    this.device.close();
    emitter?.removeAllListeners("detach");
    callback?.(null);
    this.emit("close", this.device);
  } catch (err) {
    callback?.(err);
  }

  return this;
};

module.exports = USB;
