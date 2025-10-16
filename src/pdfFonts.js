const FONT_VARIANTS = [
  {
    filename: "NotoSansKannada-Regular.ttf",
    style: "normal",
  },
  {
    filename: "NotoSansKannada-Bold.ttf",
    style: "bold",
  },
];

function withTrailingSlash(path) {
  return path.endsWith("/") ? path : `${path}/`;
}

const defaultBasePath = (() => {
  if (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) {
    return withTrailingSlash(import.meta.env.BASE_URL);
  }
  return "/";
})();

const DEFAULT_FONT_DIRECTORY = `${defaultBasePath}fonts/`;

export const KANNADA_FONT_FAMILY = "NotoSansKannada";

let fontLoadPromise = null;

function resolveFontUrl(filename) {
  const configuredBase =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_KANNADA_FONT_PATH
      ? withTrailingSlash(import.meta.env.VITE_KANNADA_FONT_PATH)
      : DEFAULT_FONT_DIRECTORY;

  if (typeof window !== "undefined" && window.location) {
    return new URL(`${configuredBase}${filename}`, window.location.origin).toString();
  }

  return `${configuredBase}${filename}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function fetchFontData(variant) {
  const response = await fetch(resolveFontUrl(variant.filename));
  if (!response.ok) {
    throw new Error(`Failed to fetch font: ${variant.filename} (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return {
    ...variant,
    base64: arrayBufferToBase64(buffer),
  };
}

function loadFontVariants() {
  if (!fontLoadPromise) {
    fontLoadPromise = Promise.all(FONT_VARIANTS.map(fetchFontData)).catch((error) => {
      fontLoadPromise = null;
      throw error;
    });
  }
  return fontLoadPromise;
}

export async function registerUnicodeFonts(doc) {
  try {
    const fonts = await loadFontVariants();
    fonts.forEach(({ filename, style, base64 }) => {
      doc.addFileToVFS(filename, base64);
      doc.addFont(filename, KANNADA_FONT_FAMILY, style, "Identity-H");
    });
  } catch (error) {
    console.error("Failed to register Kannada fonts for PDF output", error);
  }
  return doc;
}
