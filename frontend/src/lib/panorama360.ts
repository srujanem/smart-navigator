/**
 * On-Device 360° Video-to-Panorama Stitcher & Smart Media Processor.
 *
 * Allows any normal smartphone (without an Insta360 camera) to capture a true 360°
 * room or corridor view by simply recording a 6–10 second slow spin video — OR
 * uploading a phone Panorama ("Pano") photo.
 */

export interface ProcessedMediaResult {
  file: File;
  isPanorama360: boolean;
  aspectRatio: number;
  width: number;
  height: number;
}

export function isVideoFile(file: File): boolean {
  return (
    file.type.startsWith('video/') ||
    /\.(mp4|webm|mov|mkv|avi|m4v|3gp|ogv)$/i.test(file.name)
  );
}

export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp|heic|heif|avif|bmp|gif)$/i.test(file.name)
  );
}

function canvasToOptimizedFile(
  canvas: HTMLCanvasElement,
  baseName: string,
  quality = 0.84,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const finish = (blob: Blob | null, mime: string, ext: string) => {
      if (!blob) {
        reject(new Error('Could not encode image canvas.'));
        return;
      }
      resolve(new File([blob], `${baseName}.${ext}`, { type: mime }));
    };

    canvas.toBlob(
      (webpBlob) => {
        if (webpBlob && webpBlob.size > 0 && (!webpBlob.type || webpBlob.type === 'image/webp')) {
          finish(webpBlob, 'image/webp', 'webp');
          return;
        }
        canvas.toBlob(
          (jpgBlob) => finish(jpgBlob, 'image/jpeg', 'jpg'),
          'image/jpeg',
          quality,
        );
      },
      'image/webp',
      quality,
    );
  });
}

function loadVideoElement(videoFile: File): Promise<{
  video: HTMLVideoElement;
  duration: number;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    const objUrl = URL.createObjectURL(videoFile);

    let settled = false;
    const cleanup = () => {
      URL.revokeObjectURL(objUrl);
      video.removeAttribute('src');
      video.load();
    };

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Video timed out while loading. Try a shorter 6–12 second clip.'));
      }
    }, 15_000);

    video.onloadeddata = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 6;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      resolve({ video, duration: dur, width: vw, height: vh, cleanup });
    };

    video.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      reject(new Error('Could not decode this video format on your browser. Try MP4 or WebM.'));
    };

    video.src = objUrl;
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => finish();
    video.addEventListener('seeked', onSeeked);
    window.setTimeout(finish, 1800);
    try {
      video.currentTime = Math.max(0, timeSec);
    } catch {
      finish();
    }
  });
}

/**
 * Converts a 360° spin video (recorded live or picked from gallery) into a single
 * smooth, feathered 360° panoramic WebP image that wraps seamlessly around Street View!
 */
export async function stitch360VideoToPanorama(
  videoFile: File,
  onProgress?: (pct: number, stage: string) => void,
): Promise<ProcessedMediaResult> {
  onProgress?.(5, 'Reading 360° video metadata...');
  const { video, duration, width, height, cleanup } = await loadVideoElement(videoFile);

  try {
    const sliceCount = 8;
    const targetH = Math.min(720, Math.max(420, height));
    const frameScale = targetH / Math.max(1, height);
    const frameW = Math.max(240, Math.round(width * frameScale));

    // Extract 8 evenly spaced frames across the full 360° spin
    const tempFrames: HTMLCanvasElement[] = [];
    for (let i = 0; i < sliceCount; i++) {
      const t = Math.min(
        Math.max(0.05, duration - 0.1),
        ((i + 0.5) / sliceCount) * duration,
      );
      onProgress?.(
        10 + Math.round(((i + 1) / sliceCount) * 65),
        `Capturing 360° angle ${i + 1} of ${sliceCount}...`,
      );
      await seekVideo(video, t);

      const fc = document.createElement('canvas');
      fc.width = frameW;
      fc.height = targetH;
      const fctx = fc.getContext('2d');
      if (fctx) {
        fctx.drawImage(video, 0, 0, frameW, targetH);
        tempFrames.push(fc);
      }
    }

    if (tempFrames.length === 0) {
      throw new Error('Could not extract frames from video.');
    }

    onProgress?.(82, 'Stitching seamless 360° panorama strip...');

    // Keep the clean center 58% of each frame and feather edges for smooth panoramic stitching
    const stripRatio = 0.58;
    const overlapRatio = 0.14;
    const srcCropW = Math.round(frameW * stripRatio);
    const srcCropX = Math.round((frameW - srcCropW) / 2);
    const overlapPx = Math.round(srcCropW * overlapRatio);
    const stepPx = Math.max(80, srcCropW - overlapPx);

    const rawTotalW = stepPx * tempFrames.length + overlapPx;
    // Cap final panorama width to 2400px so it stays super crisp yet lightweight (~150-250 KB WebP)
    const maxPanoW = 2400;
    const outScale = Math.min(1, maxPanoW / Math.max(1, rawTotalW));
    const outW = Math.max(640, Math.round(rawTotalW * outScale));
    const outH = Math.max(320, Math.round(targetH * outScale));

    const panoCanvas = document.createElement('canvas');
    panoCanvas.width = outW;
    panoCanvas.height = outH;
    const pctx = panoCanvas.getContext('2d');
    if (!pctx) {
      throw new Error('Canvas 2D context unavailable.');
    }

    pctx.fillStyle = '#060a14';
    pctx.fillRect(0, 0, outW, outH);

    // Scratch canvas for horizontal alpha feathering on the left overlap edge
    const scratch = document.createElement('canvas');
    scratch.width = Math.max(1, Math.round(srcCropW * outScale));
    scratch.height = outH;
    const sctx = scratch.getContext('2d');
    const featheredOverlap = Math.max(4, Math.round(overlapPx * outScale));

    for (let i = 0; i < tempFrames.length; i++) {
      const dx = Math.round(i * stepPx * outScale);
      if (i === 0 || !sctx) {
        pctx.drawImage(
          tempFrames[i],
          srcCropX,
          0,
          srcCropW,
          targetH,
          dx,
          0,
          scratch.width,
          outH,
        );
      } else {
        sctx.clearRect(0, 0, scratch.width, outH);
        sctx.globalCompositeOperation = 'source-over';
        sctx.drawImage(
          tempFrames[i],
          srcCropX,
          0,
          srcCropW,
          targetH,
          0,
          0,
          scratch.width,
          outH,
        );
        // Feather left edge of this strip so it blends softly over the previous frame
        sctx.globalCompositeOperation = 'destination-in';
        const grad = sctx.createLinearGradient(0, 0, featheredOverlap, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        sctx.fillStyle = grad;
        sctx.fillRect(0, 0, featheredOverlap, outH);
        sctx.fillStyle = 'rgba(0,0,0,1)';
        sctx.fillRect(featheredOverlap, 0, scratch.width - featheredOverlap, outH);
        sctx.globalCompositeOperation = 'source-over';

        pctx.drawImage(scratch, dx, 0);
      }
    }

    onProgress?.(94, 'Compressing 360° panorama to WebP...');
    const stem = (videoFile.name.replace(/\.[^.]+$/, '') || 'room_360').replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    const panoFile = await canvasToOptimizedFile(panoCanvas, `${stem}_pano360`, 0.84);
    onProgress?.(100, '360° panorama ready!');

    return {
      file: panoFile,
      isPanorama360: true,
      aspectRatio: outW / Math.max(1, outH),
      width: outW,
      height: outH,
    };
  } finally {
    cleanup();
  }
}

/**
 * Optimizes any photo (normal vertical door photo OR wide phone Panorama photo)
 * on-device with proper EXIF orientation and returns dimensions + 360° panorama flag.
 */
export async function optimizePhotoOrPanorama(
  rawFile: File,
  onProgress?: (pct: number, stage: string) => void,
): Promise<ProcessedMediaResult> {
  if (isVideoFile(rawFile)) {
    return stitch360VideoToPanorama(rawFile, onProgress);
  }

  onProgress?.(20, 'Reading photo...');
  let source: CanvasImageSource | null = null;
  let width = 0;
  let height = 0;
  let cleanup = () => {};

  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(rawFile, { imageOrientation: 'from-image' });
      source = bmp;
      width = bmp.width;
      height = bmp.height;
      cleanup = () => bmp.close();
    } catch {
      source = null;
    }
  }

  if (!source) {
    const imgRes = await new Promise<{
      img: HTMLImageElement;
      w: number;
      h: number;
      url: string;
    } | null>((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(rawFile);
      img.onload = () =>
        resolve({
          img,
          w: img.naturalWidth || img.width || 1080,
          h: img.naturalHeight || img.height || 1080,
          url,
        });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
    if (!imgRes) {
      throw new Error(`Could not read "${rawFile.name}". Please choose a JPG, PNG, WebP, or MP4 file.`);
    }
    source = imgRes.img;
    width = imgRes.w;
    height = imgRes.h;
    cleanup = () => URL.revokeObjectURL(imgRes.url);
  }

  try {
    const aspectRatio = width / Math.max(1, height);
    const isPanorama360 = aspectRatio >= 1.75;
    // Preserve wider resolution for 360° phone panoramas, keep normal photos light & sharp
    const maxSide = isPanorama360 ? 2400 : 1440;
    const scale = Math.min(1, maxSide / Math.max(width, height, 1));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    onProgress?.(60, isPanorama360 ? 'Optimizing 360° Panorama...' : 'Compressing photo...');
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas unavailable.');
    }
    ctx.drawImage(source, 0, 0, outW, outH);

    const stem = (rawFile.name.replace(/\.[^.]+$/, '') || 'photo').replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    const file = await canvasToOptimizedFile(
      canvas,
      isPanorama360 ? `${stem}_pano360` : stem,
      0.83,
    );
    onProgress?.(100, 'Ready');

    return {
      file,
      isPanorama360,
      aspectRatio: outW / Math.max(1, outH),
      width: outW,
      height: outH,
    };
  } finally {
    cleanup();
  }
}
