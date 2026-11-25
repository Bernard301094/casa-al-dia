const gzipSuffix='.casa-gzip';
const types={pdf:'application/pdf',txt:'text/plain',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',
  webp:'image/webp',gif:'image/gif',avif:'image/avif',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'};
export const isPacked=path=>path.endsWith(gzipSuffix);
const extension=name=>name.includes('.')?name.split('.').at(-1).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,10):'';

async function photo(file,maxEdge) {
  if(!['image/jpeg','image/png'].includes(file.type)||!('createImageBitmap' in window)) return file;
  // APNG declares animation before its first image data chunk.
  if(file.type==='image/png') {
    const bytes=new DataView(await file.arrayBuffer());
    for(let offset=8;offset+8<=bytes.byteLength;) {
      const name=bytes.getUint32(offset+4);
      if(name===0x6163544c) return file;
      if(name===0x49444154) break;
      offset+=12+bytes.getUint32(offset);
    }
  }
  const bitmap=await createImageBitmap(file);
  const canvas=document.createElement('canvas');
  try {
    const scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');
    if(!ctx) return file;
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',maxEdge>1800?.82:.75));
    if(blob?.type==='image/webp'&&blob.size<file.size) {
      return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.webp',{type:blob.type});
    }
    return file;
  } finally {
    bitmap.close();
    canvas.width=canvas.height=0;
  }
}

export async function prepareAttachment(file,kind) {
  const converted=await photo(file,kind==='photo'?1600:2400).catch(()=>file);
  const ext=extension(converted.name);
  const suffix=ext?'.'+ext:'';
  if(converted===file&&'CompressionStream' in window&&'DecompressionStream' in window) {
    try {
      const packed=await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
      if(packed.size<file.size*.98) return {blob:new Blob([packed],{type:'application/gzip'}),name:file.name,suffix:suffix+gzipSuffix};
    } catch { /* Keep the readable original when compression is unavailable. */ }
  }
  return {blob:converted,name:converted.name,suffix};
}

export async function unpackAttachment(blob,path) {
  if(!isPacked(path)) return blob;
  const source=blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(source,{headers:{'Content-Type':types[extension(path.slice(0,-gzipSuffix.length))]||'application/octet-stream'}}).blob();
}
