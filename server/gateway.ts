export function buildGatewayUrl(
  req: Request,
  filename: string,
  portOverride?: number
): string {
  const port = portOverride ?? Number(process.env.PORT || 4000);
  const base =
    process.env.PUBLIC_BASE_URL ||
    `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host") || `localhost:${port}`}`;
  return `${base}/images/${filename}`;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Returns a direct, public URL to the uploaded image on S3/CDN, if configured.
 *
 * Set `S3_PUBLIC_BASE_URL` to the *public* base URL for the `uploads/` prefix,
 * e.g. `https://my-bucket.s3.us-east-1.amazonaws.com/uploads` or a CloudFront
 * URL like `https://d123.cloudfront.net/uploads`.
 */
export function buildS3PublicUploadUrl(filename: string): string | null {
  const bucket = process.env.S3_BUCKET;
  const base = process.env.S3_PUBLIC_BASE_URL;
  if (!bucket || !base) return null;
  return `${stripTrailingSlash(base)}/${filename}`;
}

/**
 * Prefer a direct S3/CDN URL when available; otherwise fall back to the gateway
 * `/images/{filename}` route.
 */
export function buildStoredImageUrl(req: Request, filename: string): string {
  return buildS3PublicUploadUrl(filename) ?? buildGatewayUrl(req, filename);
}
