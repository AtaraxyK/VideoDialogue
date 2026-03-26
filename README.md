
# Transcript Webapp (vendor-ready build)

버전: 0.3.0-vendor-ready
빌드 시각: 2026-03-26 00:00 UTC

## 왜 이 버전이 필요한가
GitHub Pages 같은 환경에서는 Web Worker 스크립트가 same-origin 제약을 받습니다.
따라서 CDN에 있는 `@ffmpeg/ffmpeg/dist/esm/worker.js` 를 직접 띄우면 브라우저가 차단할 수 있습니다.

이번 버전은 **버전/빌드 표시**를 화면에 노출하고,
FFmpeg 관련 파일을 **현재 사이트와 같은 origin의 `/vendor/...` 경로**에서 읽도록 바꾼 준비판입니다.

## 꼭 넣어야 하는 파일
아래 파일들을 저장소의 `transcript_webapp/vendor/...` 경로에 직접 넣어 주세요.

### 1) vendor/ffmpeg/
- `index.js`
- `worker.js`
- `classes.js`
- `errors.js`
- `const.js`
- `types.js` (있으면 함께)
- `utils.js` (있으면 함께)

출처 예시:
- `@ffmpeg/ffmpeg@0.12.10/dist/esm/*`

### 2) vendor/ffmpeg-util/
- `index.js`
- `errors.js`

출처 예시:
- `@ffmpeg/util@0.12.1/dist/esm/*`

### 3) vendor/ffmpeg-core/
- `ffmpeg-core.js`
- `ffmpeg-core.wasm`
- `ffmpeg-core.worker.js`

출처 예시:
- `@ffmpeg/core@0.12.6/dist/esm/*`

## 중요 체크
1. 파일들은 **반드시 현재 페이지와 같은 GitHub Pages origin** 에 있어야 합니다.
2. 올린 뒤 브라우저에서 **Ctrl+F5** 로 강력 새로고침 해 주세요.
3. 주소 끝에 `?v=20260326b` 가 붙도록 되어 있으니 캐시 구분에 도움이 됩니다.

## 화면에서 버전 확인
상단과 하단에 아래 정보가 보입니다.
- 버전
- 빌드 시각
- 빌드 메모

이걸로 웹에서 지금 어떤 배포본이 떠 있는지 바로 구분할 수 있습니다.
