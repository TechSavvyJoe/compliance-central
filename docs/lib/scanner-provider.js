const DEFAULT_CONFIG_URL = "./scanner-config.json";

function asText(bytes) {
  if (!bytes || typeof TextDecoder === "undefined") return "";
  try {
    return new TextDecoder("iso-8859-1").decode(bytes);
  } catch {
    return "";
  }
}

export function extractDynamsoftPayloads(result) {
  const items = result && (result.barcodeResultItems || result.items);
  if (!Array.isArray(items)) return [];

  const values = [];
  const seen = new Set();
  for (const item of items) {
    const format = String(item && (item.formatString || item.format || "")).toLowerCase();
    if (format && !format.includes("pdf417")) continue;
    for (const value of [item && item.text, asText(item && item.bytes)]) {
      if (typeof value !== "string" || !value.trim() || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

export async function loadScannerConfig(
  url = DEFAULT_CONFIG_URL,
  fetchImpl = globalThis.fetch
) {
  if (typeof fetchImpl !== "function") return {};
  try {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) return {};
    const config = await response.json();
    return config && typeof config === "object" ? config : {};
  } catch {
    return {};
  }
}

function loadScript(url) {
  if (!url) return Promise.reject(new Error("commercial-sdk-url-missing"));
  const existing = document.querySelector(`script[data-scanner-sdk="${url}"]`);
  if (existing && globalThis.Dynamsoft) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = existing || document.createElement("script");
    if (!existing) {
      script.src = url;
      script.async = true;
      script.dataset.scannerSdk = url;
      document.head.appendChild(script);
    }
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("commercial-sdk-load-failed")),
      { once: true }
    );
  });
}

class DynamsoftScannerProvider {
  constructor({ sdk, mount }) {
    this.name = "Dynamsoft";
    this.sdk = sdk;
    this.mount = mount;
    this.router = null;
    this.cameraView = null;
    this.cameraEnhancer = null;
    this.receiver = null;
    this.onCandidates = null;
  }

  async initialize(licenseKey) {
    const D = this.sdk;
    D.License.LicenseManager.initLicense(licenseKey);
    await D.Core.CoreModule.loadWasm(["DBR"]);

    this.router = await D.CVR.CaptureVisionRouter.createInstance();
    this.cameraView = await D.DCE.CameraView.createInstance();
    this.cameraEnhancer = await D.DCE.CameraEnhancer.createInstance(this.cameraView);
    const ui = this.cameraView.getUIElement();
    ui.classList.add("commercial-camera-view");
    ui.hidden = true;
    this.mount.insertBefore(ui, this.mount.firstChild);
    this.router.setInput(this.cameraEnhancer);

    const settings = await this.router.getSimplifiedSettings("ReadDenseBarcodes");
    settings.barcodeSettings.barcodeFormatIds = D.DBR.EnumBarcodeFormat.BF_PDF417;
    await this.router.updateSettings("ReadDenseBarcodes", settings);

    this.receiver = {
      onDecodedBarcodesReceived: (result) => {
        const values = extractDynamsoftPayloads(result);
        if (values.length && this.onCandidates) this.onCandidates(values);
      },
    };
    this.router.addResultReceiver(this.receiver);
  }

  async start(onCandidates) {
    this.onCandidates = onCandidates;
    const ui = this.cameraView.getUIElement();
    ui.hidden = false;
    await this.cameraEnhancer.open();
    await this.router.startCapturing("ReadDenseBarcodes");
  }

  async stop() {
    this.onCandidates = null;
    if (this.router) {
      try { await this.router.stopCapturing(); } catch {}
    }
    if (this.cameraEnhancer) {
      try { await this.cameraEnhancer.close(); } catch {}
    }
    if (this.cameraView) this.cameraView.getUIElement().hidden = true;
  }

  async decodeImage(file) {
    const result = await this.router.capture(file, "ReadDenseBarcodes");
    return extractDynamsoftPayloads(result);
  }
}

export async function createCommercialScannerProvider({
  mount,
  configUrl = DEFAULT_CONFIG_URL,
} = {}) {
  const config = await loadScannerConfig(configUrl);
  const providerName = String(config.provider || "auto").toLowerCase();
  const dynamsoft = config.dynamsoft || {};
  const licenseKey =
    typeof dynamsoft.licenseKey === "string" ? dynamsoft.licenseKey.trim() : "";

  if (providerName === "zxing" || !licenseKey) {
    return {
      provider: null,
      reason: providerName === "zxing" ? "disabled" : "license-key-missing",
    };
  }
  if (!mount) return { provider: null, reason: "camera-mount-missing" };

  try {
    await loadScript(dynamsoft.sdkUrl);
    if (!globalThis.Dynamsoft) throw new Error("commercial-sdk-global-missing");
    const provider = new DynamsoftScannerProvider({
      sdk: globalThis.Dynamsoft,
      mount,
    });
    await provider.initialize(licenseKey);
    return { provider, reason: "" };
  } catch (error) {
    return {
      provider: null,
      reason: error && error.message ? error.message : "commercial-sdk-unavailable",
    };
  }
}
