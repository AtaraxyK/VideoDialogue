
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0/+esm';
import { FFmpeg } from './vendor/ffmpeg/index.js?v=20260326b';
import { fetchFile } from './vendor/ffmpeg-util/index.js?v=20260326b';

const APP_VERSION = '0.3.0-vendor-ready';
const APP_BUILD_TIME = '2026-03-26 00:00 UTC';
const APP_NOTES = 'FFmpeg same-origin 대응 준비판';

const STORAGE_KEYS = {
  language: 'transcript.language',
  csv: 'transcript.csv',
};
const DB_NAME = 'transcript-tool-db';
const DB_STORE = 'handles';
const HANDLE_KEYS = {
  outputDir: 'outputDir',
};

const LANGUAGE_OPTIONS = [
  { code: 'auto', ko: '자동 선택', native: 'Auto' },
  { code: 'ko', ko: '한국어', native: '한국어' },
  { code: 'en', ko: '영어', native: 'English' },
  { code: 'ja', ko: '일본어', native: '日本語' },
  { code: 'zh', ko: '중국어', native: '中文' },
  { code: 'de', ko: '독일어', native: 'Deutsch' },
  { code: 'es', ko: '스페인어', native: 'Español' },
  { code: 'fr', ko: '프랑스어', native: 'Français' },
  { code: 'it', ko: '이탈리아어', native: 'Italiano' },
  { code: 'pt', ko: '포르투갈어', native: 'Português' },
  { code: 'ru', ko: '러시아어', native: 'Русский' },
  { code: 'ar', ko: '아랍어', native: 'العربية' },
  { code: 'hi', ko: '힌디어', native: 'हिन्दी' },
  { code: 'tr', ko: '터키어', native: 'Türkçe' },
  { code: 'vi', ko: '베트남어', native: 'Tiếng Việt' },
  { code: 'th', ko: '태국어', native: 'ไทย' },
  { code: 'id', ko: '인도네시아어', native: 'Bahasa Indonesia' },
  { code: 'nl', ko: '네덜란드어', native: 'Nederlands' },
  { code: 'pl', ko: '폴란드어', native: 'Polski' },
  { code: 'uk', ko: '우크라이나어', native: 'Українська' },
];

const SUPPORTED_VIDEO_TYPES = [
  'video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo', 'video/mpeg'
];

const state = {
  files: [],
  outputDirHandle: null,
  transcriber: null,
  ffmpeg: null,
  uiLocked: false,
};

const $ = (id) => document.getElementById(id);

const screens = {
  upload: $('screen-upload'),
  config: $('screen-config'),
  progress: $('screen-progress'),
  done: $('screen-done'),
};

function renderBuildMeta() {
  const text = `버전: ${APP_VERSION} / 빌드: ${APP_BUILD_TIME} / ${APP_NOTES}`;
  const a = $('build-meta');
  const b = $('footer-build-meta');
  if (a) a.textContent = text;
  if (b) b.textContent = text;
}

function showScreen(name) {
  Object.values(screens).forEach((el) => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });
  screens[name].classList.remove('hidden');
  screens[name].classList.add('active');
}

function log(message) {
  const box = $('progress-log');
  const time = new Date().toLocaleTimeString();
  box.textContent += `[${time}] ${message}\n`;
  box.scrollTop = box.scrollHeight;
}

function setOverallProgress(percent) {
  $('overall-progress').value = percent;
  $('overall-progress-text').textContent = `${Math.round(percent)}%`;
}

function setFileProgress(percent) {
  $('file-progress').value = percent;
  $('file-progress-text').textContent = `${Math.round(percent)}%`;
}

function setStatus(text) {
  $('progress-status').textContent = text;
}

function setCurrentFile(name) {
  $('progress-file-name').textContent = name || '-';
}

function updateFileList(targetId) {
  const container = $(targetId);
  if (!state.files.length) {
    container.className = 'simple-list empty';
    container.textContent = '선택된 파일이 없습니다.';
    return;
  }

  container.className = 'simple-list';
  container.innerHTML = '';
  state.files.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `<span>${index + 1}. ${file.name}</span><span>${formatBytes(file.size)}</span>`;
    container.appendChild(row);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function saveSimpleSettings() {
  localStorage.setItem(STORAGE_KEYS.language, $('language-select').value || 'auto');
  localStorage.setItem(STORAGE_KEYS.csv, $('csv-checkbox').checked ? '1' : '0');
}

function loadSimpleSettings() {
  const lang = localStorage.getItem(STORAGE_KEYS.language) || 'auto';
  const csv = localStorage.getItem(STORAGE_KEYS.csv) === '1';
  $('csv-checkbox').checked = csv;
  return { lang, csv };
}

function renderLanguageOptions(filter = '', selectedCode = 'auto') {
  const select = $('language-select');
  const q = filter.trim().toLowerCase();
  const items = LANGUAGE_OPTIONS.filter((lang) => {
    const display = `${lang.ko} ${lang.native} ${lang.code}`.toLowerCase();
    return display.includes(q);
  });

  select.innerHTML = '';
  items.forEach((lang) => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = `[${lang.ko} / ${lang.native}]`;
    if (lang.code === selectedCode) opt.selected = true;
    select.appendChild(opt);
  });

  if (!items.some((x) => x.code === selectedCode)) {
    select.selectedIndex = 0;
  }
}

async function openDb() {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function setHandle(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getHandle(key) {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function restoreOutputHandle() {
  try {
    const handle = await getHandle(HANDLE_KEYS.outputDir);
    if (!handle) return;
    if (typeof handle.queryPermission === 'function') {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted' || perm === 'prompt') {
        state.outputDirHandle = handle;
        $('output-folder-label').className = 'path-label';
        $('output-folder-label').textContent = `이전 출력 폴더 사용 가능`;
      }
    }
  } catch (error) {
    console.warn('출력 폴더 복원 실패', error);
  }
}

async function pickFilesViaPicker() {
  if (window.showOpenFilePicker) {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      id: 'video-input',
      types: [{
        description: '영상 파일',
        accept: { 'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.mpeg', '.mpg'] },
      }],
      excludeAcceptAllOption: false,
    });
    const files = await Promise.all(handles.map((h) => h.getFile()));
    return files;
  }

  return await new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

async function pickOutputFolder() {
  if (!window.showDirectoryPicker) {
    alert('이 브라우저는 폴더 직접 저장을 지원하지 않습니다. 결과는 다운로드 방식으로 저장됩니다.');
    return;
  }

  const handle = await window.showDirectoryPicker({ id: 'output-folder', mode: 'readwrite' });
  state.outputDirHandle = handle;
  await setHandle(HANDLE_KEYS.outputDir, handle);
  $('output-folder-label').className = 'path-label';
  $('output-folder-label').textContent = '출력 폴더 선택 완료';
}

function normalizePickedFiles(files) {
  return files.filter((f) => {
    return f && (SUPPORTED_VIDEO_TYPES.includes(f.type) || /\.(mp4|mov|mkv|webm|avi|mpeg|mpg)$/i.test(f.name));
  });
}

async function acceptFiles(files) {
  const valid = normalizePickedFiles(files);
  if (!valid.length) {
    alert('지원되는 영상 파일이 없습니다.');
    return;
  }

  state.files = valid;
  updateFileList('upload-file-list');
  updateFileList('config-file-list');

  const { lang } = loadSimpleSettings();
  renderLanguageOptions($('language-search').value, lang);
  await restoreOutputHandle();
  showScreen('config');
}

function lockConfigUi(locked) {
  state.uiLocked = locked;
  ['btn-back', 'language-search', 'language-select', 'csv-checkbox', 'btn-pick-output', 'btn-start', 'btn-pick-files'].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = locked;
  });
}

function baseName(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

function formatTimestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}


async function ensureFfmpeg() {
  if (state.ffmpeg) return state.ffmpeg;

  setStatus('오디오 추출 엔진 로딩 중');
  log('FFmpeg 엔진 로딩 시작');
  log(`앱 버전: ${APP_VERSION} / 빌드: ${APP_BUILD_TIME}`);

  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    setFileProgress(Math.max(1, Math.min(95, progress * 100)));
  });

  // 중요:
  // GitHub Pages 같은 환경에서는 Worker()가 same-origin 제약을 받습니다.
  // 따라서 @ffmpeg/ffmpeg 패키지의 worker.js 와 @ffmpeg/core 파일들을
  // 현재 사이트와 같은 origin에서 직접 서빙해야 합니다.
  const baseURL = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}vendor/ffmpeg-core`;

  await ffmpeg.load({
    classWorkerURL: './vendor/ffmpeg/worker.js?v=20260326b',
    coreURL: `${baseURL}/ffmpeg-core.js?v=20260326b`,
    wasmURL: `${baseURL}/ffmpeg-core.wasm?v=20260326b`,
    workerURL: `${baseURL}/ffmpeg-core.worker.js?v=20260326b`,
  });

  state.ffmpeg = ffmpeg;
  log('FFmpeg 엔진 로딩 완료');
  return ffmpeg;
}


async function ensureTranscriber() {
  if (state.transcriber) return state.transcriber;
  setStatus('Whisper 모델 준비 중');
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  state.transcriber = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-tiny_timestamped',
    {
      progress_callback: (info) => {
        if (info?.status === 'progress' || info?.status === 'progress_total') {
          setFileProgress(Math.max(1, Math.min(95, info.progress || 0)));
          setStatus(`모델 다운로드/준비 중 (${Math.round(info.progress || 0)}%)`);
        } else if (info?.status === 'ready') {
          setStatus('모델 준비 완료');
        }
      },
    }
  );
  return state.transcriber;
}

async function extractMono16kWav(file) {
  const ffmpeg = await ensureFfmpeg();
  const inputName = `input_${crypto.randomUUID()}_${file.name}`;
  const outputName = `output_${crypto.randomUUID()}.wav`;
  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec(['-i', inputName, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outputName]);
  const data = await ffmpeg.readFile(outputName);
  await safeDelete(ffmpeg, inputName);
  await safeDelete(ffmpeg, outputName);
  return data;
}

async function safeDelete(ffmpeg, path) {
  try { await ffmpeg.deleteFile(path); } catch (_) {}
}

function toBlobFromUint8(uint8, type = 'audio/wav') {
  return new Blob([uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength)], { type });
}

async function transcribeFile(file, languageCode) {
  setStatus('오디오 추출 중');
  setFileProgress(0);
  const wavData = await extractMono16kWav(file);

  setStatus('음성 인식 중');
  const transcriber = await ensureTranscriber();
  const audioBlob = toBlobFromUint8(wavData, 'audio/wav');
  const audioUrl = URL.createObjectURL(audioBlob);

  try {
    const options = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
    };
    if (languageCode && languageCode !== 'auto') {
      options.language = languageCode;
    }
    const output = await transcriber(audioUrl, options);
    setFileProgress(100);
    return output;
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}

function outputToRows(output) {
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  if (!chunks.length && output?.text) {
    return [{ time: '00:00:00.000', text: output.text.trim() }];
  }
  return chunks.map((chunk) => {
    const ts = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] ?? 0 : 0;
    return {
      time: formatTimestamp(ts),
      text: String(chunk.text || '').trim(),
    };
  }).filter((row) => row.text);
}

function rowsToCsv(rows) {
  const header = ['time', 'text'];
  const lines = [header.join(',')];
  rows.forEach((row) => {
    const escaped = [row.time, row.text].map((value) => {
      const s = String(value ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(escaped.join(','));
  });
  return lines.join('\n');
}

function rowsToXlsxBlob(rows) {
  const ws = window.XLSX.utils.json_to_sheet(rows.map((r) => ({ time: r.time, text: r.text })));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Transcript');
  const array = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function saveResult(baseFileName, rows, saveCsv) {
  const fileName = `${baseFileName}.${saveCsv ? 'csv' : 'xlsx'}`;
  const blob = saveCsv
    ? new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
    : rowsToXlsxBlob(rows);

  if (state.outputDirHandle) {
    let perm = 'prompt';
    if (typeof state.outputDirHandle.queryPermission === 'function') {
      perm = await state.outputDirHandle.queryPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted' && typeof state.outputDirHandle.requestPermission === 'function') {
      perm = await state.outputDirHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm === 'granted') {
      const fileHandle = await state.outputDirHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'folder';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'download';
}

async function runBatch() {
  const languageCode = $('language-select').value || 'auto';
  const saveCsv = $('csv-checkbox').checked;
  saveSimpleSettings();

  lockConfigUi(true);
  showScreen('progress');
  $('progress-log').textContent = '';
  setOverallProgress(0);
  setFileProgress(0);

  try {
    for (let i = 0; i < state.files.length; i += 1) {
      const file = state.files[i];
      setCurrentFile(file.name);
      setFileProgress(0);
      log(`처리 시작: ${file.name}`);

      const output = await transcribeFile(file, languageCode);
      const rows = outputToRows(output);
      const mode = await saveResult(baseName(file.name), rows, saveCsv);
      log(`저장 완료: ${baseName(file.name)} (${mode === 'folder' ? '선택 폴더 저장' : '다운로드'})`);

      const overall = ((i + 1) / state.files.length) * 100;
      setOverallProgress(overall);
    }

    $('done-message').textContent = '모든 파일 작성이 완료되었습니다.';
    showScreen('done');
  } catch (error) {
    console.error(error);
    alert(`작업 중 오류가 발생했습니다.\n${error?.message || error}`);
    showScreen('config');
  } finally {
    lockConfigUi(false);
  }
}

function resetToUpload() {
  state.files = [];
  updateFileList('upload-file-list');
  updateFileList('config-file-list');
  $('language-search').value = '';
  const { lang } = loadSimpleSettings();
  renderLanguageOptions('', lang);
  showScreen('upload');
}

function bindEvents() {
  const dropZone = $('drop-zone');
  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });
  dropZone.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    await acceptFiles(files);
  });

  $('btn-pick-files').addEventListener('click', async () => {
    const files = await pickFilesViaPicker();
    await acceptFiles(files);
  });

  $('btn-back').addEventListener('click', () => {
    showScreen('upload');
  });

  $('btn-pick-output').addEventListener('click', async () => {
    try {
      await pickOutputFolder();
    } catch (error) {
      console.error(error);
      alert(`출력 폴더 선택 실패: ${error?.message || error}`);
    }
  });

  $('btn-start').addEventListener('click', async () => {
    if (!state.files.length) {
      alert('먼저 영상 파일을 선택해 주세요.');
      return;
    }
    await runBatch();
  });

  $('language-search').addEventListener('input', (e) => {
    const current = $('language-select').value || loadSimpleSettings().lang || 'auto';
    renderLanguageOptions(e.target.value, current);
  });

  $('screen-done').addEventListener('click', () => {
    resetToUpload();
  });
}

async function init() {
  renderBuildMeta();
  loadSimpleSettings();
  const { lang } = loadSimpleSettings();
  renderLanguageOptions('', lang);
  updateFileList('upload-file-list');
  updateFileList('config-file-list');
  bindEvents();
  const note = document.createElement('div');
  note.className = 'error-note';
  note.innerHTML = '중요: 이 버전은 FFmpeg worker same-origin 문제 대응용입니다. <code>vendor</code> 폴더에 FFmpeg 정적 파일을 같이 올려야 실제 동작합니다. 자세한 파일 목록은 README.md를 확인해 주세요.';
  $('screen-upload').appendChild(note);
  await restoreOutputHandle();
}

init();
