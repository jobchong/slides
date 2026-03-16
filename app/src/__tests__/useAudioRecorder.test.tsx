import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { useAudioRecorder } from "../hooks/useAudioRecorder";

const originalMediaRecorder = globalThis.MediaRecorder;
const originalNavigator = globalThis.navigator;

type MockRecorderController = {
  getLastRecorder: () => MockMediaRecorder | null;
  getStopCallCount: () => number;
  getTrackStopCount: () => number;
};

class MockMediaRecorder {
  static supportedTypes = ["audio/webm;codecs=opus"];

  static isTypeSupported(type: string) {
    return MockMediaRecorder.supportedTypes.includes(type);
  }

  state = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(_stream: MediaStream, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

function installRecorderMocks(options?: {
  supportedTypes?: string[];
  getUserMedia?: () => Promise<MediaStream>;
}): MockRecorderController {
  let lastRecorder: MockMediaRecorder | null = null;
  let stopCallCount = 0;
  let trackStopCount = 0;

  class RecorderWithTracking extends MockMediaRecorder {
    static override supportedTypes = options?.supportedTypes ?? ["audio/webm;codecs=opus"];

    constructor(stream: MediaStream, config: { mimeType: string }) {
      super(stream, config);
      lastRecorder = this;
    }

    override stop() {
      stopCallCount += 1;
      super.stop();
    }
  }

  Object.defineProperty(globalThis, "MediaRecorder", {
    value: RecorderWithTracking,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: {
      ...originalNavigator,
      mediaDevices: {
        getUserMedia:
          options?.getUserMedia ??
          (async () =>
            ({
              getTracks: () => [
                {
                  stop: () => {
                    trackStopCount += 1;
                  },
                },
              ],
            }) as MediaStream),
      },
    },
    configurable: true,
    writable: true,
  });

  return {
    getLastRecorder: () => lastRecorder,
    getStopCallCount: () => stopCallCount,
    getTrackStopCount: () => trackStopCount,
  };
}

describe("useAudioRecorder", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(globalThis, "MediaRecorder", {
      value: originalMediaRecorder,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  test("stops recording with the initial stop callback", async () => {
    const controller = installRecorderMocks();

    let recorderApi: ReturnType<typeof useAudioRecorder> | null = null;

    function Harness() {
      const api = useAudioRecorder();
      useEffect(() => {
        recorderApi = api;
      }, [api]);
      return null;
    }

    render(<Harness />);

    const stopRecording = recorderApi!.stopRecording;

    await act(async () => {
      await recorderApi!.startRecording();
    });

    const result = await act(async () => stopRecording());

    expect(controller.getStopCallCount()).toBe(1);
    expect(controller.getLastRecorder()?.state).toBe("inactive");
    expect(result).toBeInstanceOf(Blob);
  });

  test("reports unsupported browsers before requesting a microphone", async () => {
    Object.defineProperty(globalThis, "MediaRecorder", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        ...originalNavigator,
        mediaDevices: undefined,
      },
      configurable: true,
      writable: true,
    });

    let recorderApi: ReturnType<typeof useAudioRecorder> | null = null;

    function Harness() {
      const api = useAudioRecorder();
      useEffect(() => {
        recorderApi = api;
      }, [api]);
      return null;
    }

    render(<Harness />);

    await act(async () => {
      await recorderApi!.startRecording();
    });

    expect(recorderApi!.isSupported).toBe(false);
    expect(recorderApi!.recordingState).toBe("idle");
    expect(recorderApi!.error).toBe("Audio recording is not supported in your browser.");
  });

  test("surfaces microphone permission errors", async () => {
    installRecorderMocks({
      getUserMedia: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });

    let recorderApi: ReturnType<typeof useAudioRecorder> | null = null;

    function Harness() {
      const api = useAudioRecorder();
      useEffect(() => {
        recorderApi = api;
      }, [api]);
      return null;
    }

    render(<Harness />);

    await act(async () => {
      await recorderApi!.startRecording();
    });

    expect(recorderApi!.recordingState).toBe("error");
    expect(recorderApi!.error).toBe("Microphone permission denied. Please allow access.");
  });

  test("resets the recorder state and stops tracks when canceled", async () => {
    const controller = installRecorderMocks();

    let recorderApi: ReturnType<typeof useAudioRecorder> | null = null;

    function Harness() {
      const api = useAudioRecorder();
      useEffect(() => {
        recorderApi = api;
      }, [api]);
      return null;
    }

    render(<Harness />);

    await act(async () => {
      await recorderApi!.startRecording();
    });

    act(() => {
      recorderApi!.cancelRecording();
    });

    expect(controller.getStopCallCount()).toBe(1);
    expect(controller.getTrackStopCount()).toBe(1);
    expect(recorderApi!.recordingState).toBe("idle");
    expect(recorderApi!.recordingDuration).toBe(0);
    expect(recorderApi!.error).toBeNull();
  });

  test("surfaces runtime recorder errors", async () => {
    const controller = installRecorderMocks();

    let recorderApi: ReturnType<typeof useAudioRecorder> | null = null;

    function Harness() {
      const api = useAudioRecorder();
      useEffect(() => {
        recorderApi = api;
      }, [api]);
      return null;
    }

    render(<Harness />);

    await act(async () => {
      await recorderApi!.startRecording();
    });

    act(() => {
      controller.getLastRecorder()?.onerror?.(new Event("error"));
    });

    expect(recorderApi!.recordingState).toBe("error");
    expect(recorderApi!.error).toBe("Recording failed. Please try again.");
  });

  test("returns null when stop is called before recording starts", async () => {
    installRecorderMocks();

    let recorderApi: ReturnType<typeof useAudioRecorder> | null = null;

    function Harness() {
      const api = useAudioRecorder();
      useEffect(() => {
        recorderApi = api;
      }, [api]);
      return null;
    }

    render(<Harness />);

    const result = await act(async () => recorderApi!.stopRecording());

    expect(result).toBeNull();
  });

  test("stops active tracks during unmount cleanup", async () => {
    const controller = installRecorderMocks();

    let recorderApi: ReturnType<typeof useAudioRecorder> | null = null;

    function Harness() {
      const api = useAudioRecorder();
      useEffect(() => {
        recorderApi = api;
      }, [api]);
      return null;
    }

    const view = render(<Harness />);

    await act(async () => {
      await recorderApi!.startRecording();
    });

    view.unmount();

    expect(controller.getTrackStopCount()).toBe(1);
  });
});
