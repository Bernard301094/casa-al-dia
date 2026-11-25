import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

const assets = new URL('./',import.meta.url);
GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs',assets).href;

export async function extractDocument(file) {
  let worker;
  async function recognize(image) {
    worker ??= await createWorker(['spa','por'],1,{workerPath:new URL('ocr.worker.min.js',assets).href});
    return (await worker.recognize(image)).data.text;
  }
  try {
    if (file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name)) return {text:await recognize(file),truncated:false};
    const documentTask=getDocument({
      data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
      wasmUrl:new URL('pdf-wasm/',assets).href,
    });
    try {
      const pdf=await documentTask.promise;
      const sections=[];
      for (let number=1;number<=Math.min(pdf.numPages,3);number++) {
        const page=await pdf.getPage(number);
        const content=await page.getTextContent();
        const text=content.items.map(item=>('str' in item ? item.str+(item.hasEOL?'\n':' ') : '')).join('');
        if (text.trim()) {sections.push(text);continue;}
        const dimensions=page.getViewport({scale:1});
        const viewport=page.getViewport({scale:1800/Math.max(dimensions.width,dimensions.height)});
        const canvas=window.document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);
        canvas.height=Math.ceil(viewport.height);
        await page.render({canvas,viewport}).promise;
        sections.push(await recognize(canvas));
      }
      return {text:sections.join('\n'),truncated:pdf.numPages>3};
    } finally {
      await documentTask.destroy();
    }
  } finally {
    if (worker) await worker.terminate();
  }
}

export function suggestEvent(text) {
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const time=text.match(/\b([01]?\d|2[0-3])(?:[:hH])([0-5]\d)\b/);
  const iso=text.match(/\b(20\d\d)-(0[1-9]|1[0-2])-([0-3]\d)\b/);
  const local=text.match(/\b([0-3]?\d)[/.\-]([01]?\d)[/.\-](20\d\d)\b/);
  let date=iso?.[0] || (local && [local[3],local[2].padStart(2,'0'),local[1].padStart(2,'0')].join('-')) || '';
  const parsed=new Date(date+'T00:00:00Z');
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10)!==date) date='';
  return {
    title:lines.find(line=>/\p{L}{3}/u.test(line))?.slice(0,160)??'',
    entry_date:date,
    entry_time:time?time[1].padStart(2,'0')+':'+time[2]:'',
    details:text.trim().slice(0,4000),
  };
}
