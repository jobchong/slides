/**
 * Error types with user-friendly messages and actionable suggestions
 */

export interface AppError {
  message: string;
  suggestion?: string;
  retryable: boolean;
}

export function classifyNetworkError(err: unknown): AppError {
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return {
      message: "Unable to connect to server",
      suggestion: "Check your internet connection and try again",
      retryable: true,
    };
  }

  if (err instanceof Error) {
    if (err.name === "AbortError" || err.message.includes("timed out")) {
      return {
        message: "Request timed out",
        suggestion: "The server took too long to respond. Try again",
        retryable: true,
      };
    }

    if (err.message.includes("NetworkError") || err.message.includes("network")) {
      return {
        message: "Network error",
        suggestion: "Check your internet connection and try again",
        retryable: true,
      };
    }
  }

  return {
    message: err instanceof Error ? err.message : "Unknown error occurred",
    retryable: true,
  };
}

export function classifyUploadError(err: unknown, file: File): AppError {
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (file.size > maxSize) {
    return {
      message: `File too large (${formatFileSize(file.size)})`,
      suggestion: `Maximum size is ${formatFileSize(maxSize)}. Try a smaller image`,
      retryable: false,
    };
  }

  if (err instanceof Error) {
    if (err.message.includes("413") || err.message.toLowerCase().includes("too large")) {
      return {
        message: "File too large for server",
        suggestion: "Try compressing the image or using a smaller file",
        retryable: false,
      };
    }

    if (err.message.includes("415") || err.message.toLowerCase().includes("unsupported")) {
      return {
        message: "Unsupported file type",
        suggestion: "Use JPEG, PNG, WebP, or GIF images",
        retryable: false,
      };
    }

    if (err.message.includes("401") || err.message.includes("403")) {
      return {
        message: "Upload not authorized",
        suggestion: "Try refreshing the page",
        retryable: true,
      };
    }
  }

  const networkError = classifyNetworkError(err);
  if (networkError.message !== (err instanceof Error ? err.message : "Unknown error occurred")) {
    return networkError;
  }

  return {
    message: "Upload failed",
    suggestion: "Check the file and try again",
    retryable: true,
  };
}

export function classifyRecordingError(err: unknown): AppError {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return {
        message: "Microphone access denied",
        suggestion: "Allow microphone permission in your browser settings",
        retryable: true,
      };
    }

    if (err.name === "NotFoundError") {
      return {
        message: "No microphone found",
        suggestion: "Connect a microphone and try again",
        retryable: true,
      };
    }

    if (err.name === "NotReadableError") {
      return {
        message: "Microphone is busy",
        suggestion: "Close other apps using the microphone and try again",
        retryable: true,
      };
    }
  }

  return {
    message: "Recording failed",
    suggestion: "Check your microphone connection and try again",
    retryable: true,
  };
}

export function classifyGenerationError(err: unknown): AppError {
  if (err instanceof Error) {
    if (err.message.includes("timed out")) {
      return {
        message: "Generation timed out",
        suggestion: "The AI took too long. Try a simpler request",
        retryable: true,
      };
    }

    if (err.message.includes("rate limit") || err.message.includes("429")) {
      return {
        message: "Too many requests",
        suggestion: "Wait a moment and try again",
        retryable: true,
      };
    }

    if (err.message.includes("500") || err.message.includes("server error")) {
      return {
        message: "Server error",
        suggestion: "Something went wrong on our end. Try again",
        retryable: true,
      };
    }
  }

  const networkError = classifyNetworkError(err);
  if (networkError.message !== (err instanceof Error ? err.message : "Unknown error occurred")) {
    return networkError;
  }

  return {
    message: err instanceof Error ? err.message : "Generation failed",
    retryable: true,
  };
}

export function classifyImportError(err: unknown): AppError {
  if (err instanceof Error) {
    if (err.message.includes("invalid") || err.message.includes("corrupt")) {
      return {
        message: "Invalid PowerPoint file",
        suggestion: "The file may be corrupted. Try re-exporting from PowerPoint",
        retryable: false,
      };
    }

    if (err.message.includes("password")) {
      return {
        message: "Password-protected file",
        suggestion: "Remove password protection and try again",
        retryable: false,
      };
    }
  }

  const networkError = classifyNetworkError(err);
  if (networkError.message !== (err instanceof Error ? err.message : "Unknown error occurred")) {
    return networkError;
  }

  return {
    message: err instanceof Error ? err.message : "Import failed",
    suggestion: "Check the file and try again",
    retryable: true,
  };
}

export function classifyExportError(err: unknown): AppError {
  if (err instanceof Error) {
    if (err.message.includes("timed out")) {
      return {
        message: "Export timed out",
        suggestion: "Try exporting fewer slides at once",
        retryable: true,
      };
    }
  }

  const networkError = classifyNetworkError(err);
  if (networkError.message !== (err instanceof Error ? err.message : "Unknown error occurred")) {
    return networkError;
  }

  return {
    message: err instanceof Error ? err.message : "Export failed",
    retryable: true,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatError(error: AppError): string {
  if (error.suggestion) {
    return `${error.message}. ${error.suggestion}`;
  }
  return error.message;
}
