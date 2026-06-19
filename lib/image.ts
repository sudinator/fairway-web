// Downsize any user-picked image into a small square avatar entirely in the
// browser, BEFORE upload — so a 5 MB phone photo becomes a ~15-30 KB square and
// only that ever reaches storage. Center-crops to a square, scales to `size`px,
// re-encodes as compressed JPEG.
export async function resizeToAvatar(file: File, size = 512, quality = 0.82): Promise<Blob> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("That file doesn't look like an image."));
    i.src = dataUrl;
  });

  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing isn't supported on this device.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (!blob) throw new Error("Couldn't process that image. Try a different photo.");
  return blob;
}
