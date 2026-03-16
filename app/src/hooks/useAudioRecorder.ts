import { useState, useRef, useCallback, useEffect } from "react";

export type RecordingState = "idle" | "recording" | "uploading" | "processing" | "error";

interface UseAudioRecorderResult {
  recordingState: RecordingState;
  recordingDuration: number;
  error: string | null;
  isSupported: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  cancelRecording: () => void;
  setRecordingState: (state: RecordingState) => void;
  setError: (error: string | null) => void;
}

const MAX_RECORDING_SECONDS = 120; // 2 minutes

export function useAudioRecorder(): UseAudioRecorderResult {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const isSupported = Boolean(
    navigator.mediaDevices && "getUserMedia" in navigator.mediaDevices && typeof MediaRecorder !== "undefined"
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError("Audio recording is not supported in your browser.");
      return;
    }

    try {
      setError(null);
      chunksRef.current = [];
      setRecordingDuration(0);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
        video: false,
      });
      streamRef.current = stream;

      // Try different MIME types in order of preference
      let mimeType = "";
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];

      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      if (!mimeType) {
        throw new Error("No supported audio MIME type found");
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        setError("Recording failed. Please try again.");
        setRecordingState("error");
      };

      mediaRecorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();
      setRecordingState("recording");

      // Start timer using requestAnimationFrame for smoother updates
      const tick = () => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingDuration(elapsed);

        // Auto-stop at max duration
        if (elapsed >= MAX_RECORDING_SECONDS) {
          stopRecording();
        } else {
          timerRef.current = window.requestAnimationFrame(tick);
        }
      };
      timerRef.current = window.requestAnimationFrame(tick);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Microphone permission denied. Please allow access.");
      } else {
        setError("Failed to start recording. Please check your microphone.");
      }
      setRecordingState("error");
    }
  }, [isSupported]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder || mediaRecorder.state !== "recording") {
        resolve(null);
        return;
      }

      mediaRecorder.onstop = () => {
        if (timerRef.current) {
          cancelAnimationFrame(timerRef.current);
          timerRef.current = null;
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        chunksRef.current = [];
        resolve(blob);
      };

      mediaRecorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }

    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    chunksRef.current = [];
    setRecordingState("idle");
    setRecordingDuration(0);
    setError(null);
  }, []);

  return {
    recordingState,
    recordingDuration,
    error,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
    setRecordingState,
    setError,
  };
}
