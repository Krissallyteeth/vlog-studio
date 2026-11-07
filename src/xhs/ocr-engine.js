/*
 * Browser OCR (tesseract.js, Simplified Chinese + English). Worker, WASM core and language data
 * are served by this app under /ocr/ (see vite.config.js), so nothing is sent to another server.
 * The language data is cached by the browser after the first use.
 */

let workerPromise = null;
let onProgress = () => {};
// Loading the engine stops if nothing arrives for this long (a stalled download, e.g. while the
// site is being redeployed): an error the screen can show, instead of waiting forever.
const STALL_MS = 60000;

/** Error thrown when the engine itself could not be loaded (not one image failing). */
export class OcrEngineError extends Error {}

async function getWorker() {
  if (!workerPromise) {
    const { createWorker } = await import('tesseract.js');
    const base = new URL(import.meta.env?.BASE_URL ?? '/', location.href).href;
    let timer = null;
    let fail = () => {};
    const stalled = new Promise((_, reject) => {
      fail = (why) => reject(new OcrEngineError(why));
    });
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fail('stalled'), STALL_MS);
    };
    kick();
    const created = createWorker(['chi_sim', 'eng'], 1, {
      workerPath: `${base}ocr/worker.min.js`,
      corePath: `${base}ocr/`,
      langPath: `${base}ocr/lang`,
      gzip: true,
      logger: (m) => {
        kick();
        onProgress(m);
      },
      errorHandler: (e) => fail(e?.message ?? String(e)),
    });
    workerPromise = Promise.race([created, stalled])
      .finally(() => clearTimeout(timer))
      .catch((err) => {
        workerPromise = null;
        // A worker that loads after all is not left running.
        created.then((w) => w.terminate()).catch(() => {});
        throw err instanceof OcrEngineError ? err : new OcrEngineError(err?.message ?? String(err));
      });
  }
  return workerPromise;
}

/**
 * Grayscale with the light grey labels darkened (same size, so word boxes match the original).
 * Measured on 薯条 order screenshots: one more field read and titles read more cleanly; enlarging
 * or pure black/white made it worse.
 */
async function grayscale(image) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return image;
  const bmp = await createImageBitmap(image);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    a[i] = a[i + 1] = a[i + 2] = Math.max(0, Math.min(255, ((y - 60) * 255) / 175));
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** Recognises one image (File/Blob/URL). Returns { text, lines } with word boxes and confidences. */
export async function recognize(image, progress = () => {}, { gray = false } = {}) {
  onProgress = progress;
  const worker = await getWorker();
  const input = gray ? await grayscale(image).catch(() => image) : image;
  const { data } = await worker.recognize(input, {}, { text: true, blocks: true, hocr: false, tsv: false });
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).map((l) => ({
    text: l.text,
    words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
  }));
  return { text: data.text, lines };
}

/** Reads one line of text (a small, cleaned crop): page segmentation "single line", then back. */
export async function recognizeLine(image, { digits = false } = {}) {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: digits ? '0123456789.,%' : '' });
  try {
    const { data } = await worker.recognize(image);
    return { text: String(data.text ?? '').trim(), confidence: data.confidence ?? 0 };
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' }); // tesseract.js defaults
  }
}

export async function terminateOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
