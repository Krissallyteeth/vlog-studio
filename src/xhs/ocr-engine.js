/*
 * Browser OCR (tesseract.js, Simplified Chinese + English). Worker, WASM core and language data
 * are served by this app under /ocr/ (see vite.config.js), so nothing is sent to another server.
 * The language data is cached by the browser after the first use.
 */

let workerPromise = null;
let onProgress = () => {};

async function getWorker() {
  if (!workerPromise) {
    const { createWorker } = await import('tesseract.js');
    const base = new URL(import.meta.env?.BASE_URL ?? '/', location.href).href;
    workerPromise = createWorker(['chi_sim', 'eng'], 1, {
      workerPath: `${base}ocr/worker.min.js`,
      corePath: `${base}ocr/`,
      langPath: `${base}ocr/lang`,
      gzip: true,
      logger: (m) => onProgress(m),
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Recognises one image (File/Blob/URL). Returns { text, lines } with word boxes and confidences. */
export async function recognize(image, progress = () => {}) {
  onProgress = progress;
  const worker = await getWorker();
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true, hocr: false, tsv: false });
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).map((l) => ({
    text: l.text,
    words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
  }));
  return { text: data.text, lines };
}

export async function terminateOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
