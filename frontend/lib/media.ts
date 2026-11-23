// Module-level camera singleton: survives client-side navigation from /check to /exam.
let stream: MediaStream | null = null;

export async function startCamera(): Promise<MediaStream> {
  if (stream && stream.getVideoTracks().some((t) => t.readyState === "live")) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
  return stream;
}
export const getStream = () => stream;

export function captureJpeg(video: HTMLVideoElement): Promise<Blob | null> {
  if (!video.videoWidth) return Promise.resolve(null);
  const c = document.createElement("canvas");
  c.width = 320; c.height = Math.round((320 * video.videoHeight) / video.videoWidth);
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.55));
}
