export function projectOverlayRect(box, video, layer, guide = { left: 0, top: 0, width: 1, height: 1 }) {
  if (!box || !video.videoWidth || !video.videoHeight) return null;
  const cropW = guide.width * video.videoWidth, cropH = guide.height * video.videoHeight;
  return { left: (guide.left * video.videoWidth + box.x0) / video.videoWidth * layer.clientWidth, top: (guide.top * video.videoHeight + box.y0) / video.videoHeight * layer.clientHeight, width: (box.x1 - box.x0) / video.videoWidth * layer.clientWidth, height: (box.y1 - box.y0) / video.videoHeight * layer.clientHeight };
}
