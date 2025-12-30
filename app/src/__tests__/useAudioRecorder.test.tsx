import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { useAudioRecorder } from "../hooks/useAudioRecorder";

describe("useAudioRecorder", () => {
  test("stops recording with the initial stop callback", async () => {
    GlobalRegistrator.register();

    const originalMediaRecorder = globalThis.MediaRecorder;
    const originalNavigator = globalThis.navigator;
    let stopCalled = false;
    let lastRecorder: MockMediaRecorder | null = null;

    class MockMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state = "inactive";
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(_stream: MediaStream, options: { mimeType: string }) {
        this.mimeType = options.mimeType;
        lastRecorder = this;
      }

      start() {
        this.state = "recording";
      }

      stop() {
        stopCalled = true;
        this.state = "inactive";
        this.onstop?.();
      }
    }

    Object.defineProperty(globalThis, "MediaRecorder", {
      value: MockMediaRecorder,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        ...originalNavigator,
        mediaDevices: {
          getUserMedia: async () =>
            ({
              getTracks: () => [{ stop: () => {} }],
            }) as MediaStream,
        },
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

    const stopRecording = recorderApi!.stopRecording;

    await act(async () => {
      await recorderApi!.startRecording();
    });

    const result = await act(async () => stopRecording());

    expect(stopCalled).toBe(true);
    expect(lastRecorder?.state).toBe("inactive");
    expect(result).toBeInstanceOf(Blob);

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
});
