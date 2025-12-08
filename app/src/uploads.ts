const baseUrl =
  import.meta.env.VITE_UPLOAD_API_URL || "http://localhost:4000";

interface UploadResponse {
  url: string;
  filename: string;
  size: number;
  type: string;
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed with ${response.status}`);
  }

  const data = (await response.json()) as UploadResponse;
  if (!data.url) {
    throw new Error("Upload response missing url");
  }

  return data;
}
