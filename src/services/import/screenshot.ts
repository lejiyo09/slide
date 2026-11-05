/**
 * 화면 캡처 (Screen Capture API: navigator.mediaDevices.getDisplayMedia)
 * 사용자가 공유할 화면/창/탭을 선택하면 첫 프레임을 PNG 파일로 반환한다.
 */
export async function captureScreenshot(): Promise<File | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('이 브라우저는 화면 캡처를 지원하지 않습니다');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return blob ? new File([blob], `스크린샷 ${new Date().toLocaleString('ko-KR')}.png`, { type: 'image/png' }) : null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
