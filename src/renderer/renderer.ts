type OverlayState = 'idle' | 'starting' | 'recording' | 'processing' | 'typing' | 'error';

interface OverlayPayload {
  transcription?: string;
  error?: string;
}

const container = document.getElementById('main-container') as HTMLElement | null;
const stateViews: Record<OverlayState, HTMLElement | null> = {
  idle: document.getElementById('state-idle') as HTMLElement | null,
  starting: document.getElementById('state-starting') as HTMLElement | null,
  recording: document.getElementById('state-recording') as HTMLElement | null,
  processing: document.getElementById('state-processing') as HTMLElement | null,
  typing: document.getElementById('state-typing') as HTMLElement | null,
  error: document.getElementById('state-error') as HTMLElement | null
};

const transcriptionEl = document.getElementById('transcription-text') as HTMLElement | null;
const errorEl = document.getElementById('error-text') as HTMLElement | null;
const appIconEl = document.getElementById('active-app-icon') as HTMLImageElement | null;
const eqBars = Array.from(document.querySelectorAll<HTMLElement>('.eq-bar'));

async function updateActiveAppIcon(): Promise<void> {
  if (!appIconEl || !overlayAPI?.getActiveAppInfo) {
    return;
  }
  
  try {
    const appInfo = await overlayAPI.getActiveAppInfo();
    if (appInfo?.iconDataUrl && appInfo.iconDataUrl.length > 0) {
      appIconEl.src = appInfo.iconDataUrl;
    } else {
      appIconEl.src = '';
    }
  } catch (error) {
    appIconEl.src = '';
  }
}

type OverlayElectronAPI = {
  getState: () => Promise<string>;
  onStateChange: (callback: (state: string) => void) => void;
  onTranscriptionResult: (callback: (text: string) => void) => void;
  onError: (callback: (error: string) => void) => void;
  toggleRecording: () => Promise<void>;
  hideOverlay: () => Promise<void>;
  getActiveAppInfo: () => Promise<{ name: string; iconDataUrl?: string }>;
};

const overlayAPI: Partial<OverlayElectronAPI> | undefined = (window as any).electronAPI;

let currentState: OverlayState = 'idle';

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let rafId: number | null = null;
let audioEnabled = false;

const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function setContainerMode(state: OverlayState) {
  if (!container) return;

  container.classList.remove(
    'starting-mode',
    'recording-mode',
    'processing-mode',
    'typing-mode',
    'error-mode'
  );

  switch (state) {
    case 'starting':
      container.classList.add('starting-mode');
      break;
    case 'recording':
      container.classList.add('recording-mode');
      break;
    case 'processing':
      container.classList.add('processing-mode');
      break;
    case 'typing':
      container.classList.add('typing-mode');
      break;
    case 'error':
      container.classList.add('error-mode');
      break;
    case 'idle':
    default:
      break;
  }
}

function applyState(state: OverlayState, payload?: OverlayPayload) {
  currentState = state;

  (Object.keys(stateViews) as OverlayState[]).forEach(key => {
    const view = stateViews[key];
    if (!view) return;
    if (key === state) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  if (payload?.transcription && transcriptionEl) {
    transcriptionEl.textContent = payload.transcription;
  }
  if (payload?.error && errorEl) {
    errorEl.textContent = payload.error;
  }

  setContainerMode(state);

  if (state === 'recording') {
    void startAudioVisualizer();
  } else {
    stopAudioVisualizer();
  }

  void updateActiveAppIcon();
}

async function ensureAudioContext(): Promise<boolean> {
  if (prefersReducedMotion) {
    return false;
  }

  if (audioContext && analyser && mediaStream) {
    return true;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return false;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    audioEnabled = true;
    return true;
  } catch (err: any) {
    audioEnabled = false;
    return false;
  }
}

async function startAudioVisualizer() {
  if (rafId !== null) {
    return;
  }

  const ok = await ensureAudioContext();

  if (!ok || !analyser) {
    // Fallback: simple breathing animation using CSS transforms
    eqBars.forEach((bar, index) => {
      const phase = (index / eqBars.length) * Math.PI;
      const base = 0.2 + 0.3 * Math.sin(phase);
      bar.style.transform = `scaleY(${base})`;
      bar.style.opacity = '0.6';
    });
    return;
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const render = () => {
    if (!analyser) return;

    analyser.getByteFrequencyData(dataArray);

    eqBars.forEach((bar, index) => {
      const binIndex = Math.min(
        bufferLength - 1,
        Math.floor((index / Math.max(eqBars.length - 1, 1)) * bufferLength)
      );
      const value = dataArray[binIndex] / 255; // 0..1
      const scaled = Math.max(0.12, Math.min(1, value * 1.8));
      bar.style.transform = `scaleY(${scaled})`;
      bar.style.opacity = (0.4 + scaled * 0.6).toFixed(2);
    });

    rafId = window.requestAnimationFrame(render);
  };

  rafId = window.requestAnimationFrame(render);
}

function stopAudioVisualizer() {
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (!audioEnabled) {
    return;
  }

  eqBars.forEach(bar => {
    bar.style.transform = 'scaleY(0.25)';
    bar.style.opacity = '0.5';
  });
}

function cycleStateFromUserAction() {
  switch (currentState) {
    case 'idle':
    case 'typing':
    case 'error':
      applyState('starting');
      setTimeout(() => {
        if (currentState === 'starting') {
          applyState('recording');
        }
      }, 200);
      break;
    case 'recording':
      applyState('processing');
      setTimeout(() => {
        if (currentState === 'processing') {
          applyState('typing');
        }
      }, 400);
      break;
    case 'starting':
    case 'processing':
    default:
      applyState('idle');
      break;
  }
}

function setupInteractions() {
  if (!container) return;

  container.addEventListener('click', () => {
    if (overlayAPI?.toggleRecording) {
      void overlayAPI.toggleRecording().catch(() => undefined);
      return;
    }
    cycleStateFromUserAction();
  });

  container.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (overlayAPI?.toggleRecording) {
        void overlayAPI.toggleRecording().catch(() => undefined);
      } else {
        cycleStateFromUserAction();
      }
    }
  });
}

function wireElectronAPI() {
  if (!overlayAPI) return;

  overlayAPI.onStateChange?.((state: string) => {
    applyState(state as OverlayState);
  });

  overlayAPI.onTranscriptionResult?.((text: string) => {
    const snippet = text.length > 25 ? `${text.substring(0, 25)}…` : text;
    if (transcriptionEl) {
      transcriptionEl.textContent = `"${snippet}"`;
    }
    applyState('typing');
  });

  overlayAPI.onError?.((error: string) => {
    if (errorEl) {
      errorEl.textContent = error.toUpperCase();
    }
    applyState('error');
    setTimeout(() => {
      if (currentState === 'error') {
        applyState('idle');
      }
    }, 3000);
  });

  overlayAPI.getState?.()
    .then(state => {
      applyState((state as OverlayState) || 'idle');
    })
    .catch(() => {
      applyState('idle');
    });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      void overlayAPI.hideOverlay?.().catch(() => undefined);
    }
  });
}

function init() {
  setupInteractions();
  applyState('idle');
  wireElectronAPI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
