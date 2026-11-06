import { HeadBucketCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { StorageConfig } from "@wayfinder/domain";

// What S3-compatible servers (SeaweedFS, MinIO) sign with when they are given
// no region, and where S3 itself answers with a redirect to the real one.
const FALLBACK_REGION = "us-east-1";

const NOT_FOUND_NAMES = new Set(["NotFound", "NoSuchKey", "NoSuchBucket"]);

// Only `send` is used, so tests can stand in a fake without a live endpoint.
export type S3Sender = Pick<S3Client, "send">;

// Shared by the document-storage adapter and the connectivity probe so the two
// cannot drift.
export const s3ClientConfig = (config: StorageConfig): S3ClientConfig => {
  const regionConfigured = config.region.length > 0;
  return {
    endpoint: `${config.useSSL ? "https" : "http"}://${config.endpoint}:${config.port}`,
    region: regionConfigured ? config.region : FALLBACK_REGION,
    // A blank region used to mean per-bucket discovery. Following S3's region
    // redirect keeps that working for a bucket outside us-east-1.
    followRegionRedirects: !regionConfigured,
    forcePathStyle: config.pathStyle,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    // The SDK otherwise adds a CRC32 checksum to every upload, which not every
    // S3-compatible server accepts.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
};

export const createS3Client = (config: StorageConfig): S3Sender => new S3Client(s3ClientConfig(config));

// HEAD responses have no body to name the error, so a bare 404 counts too.
export const isNotFound = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (name && NOT_FOUND_NAMES.has(name)) return true;
  return $metadata?.httpStatusCode === 404;
};

export const bucketExists = async (client: S3Sender, bucket: string): Promise<boolean> => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
};
