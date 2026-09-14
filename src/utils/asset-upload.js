export const MAX_VIDEO_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_LABEL = "25 MB";

export function assertAssetUploadSize(file, assetType = "") {
  const isVideo = assetType === "Video" || file?.type?.startsWith("video/");
  if (isVideo && Number(file?.size || 0) > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(
      `Uploaded videos must be ${MAX_VIDEO_UPLOAD_LABEL} or smaller. ` +
      "Compress this file or use a YouTube link instead.",
    );
  }
}
