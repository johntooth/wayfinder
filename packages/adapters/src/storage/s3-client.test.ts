import { describe, expect, it } from "vitest";
import { HeadBucketCommand, S3ServiceException } from "@aws-sdk/client-s3";
import type { StorageConfig } from "@wayfinder/domain";
import { bucketExists, isNotFound, s3ClientConfig, type S3Sender } from "./s3-client";

const config = (overrides: Partial<StorageConfig> = {}): StorageConfig => ({
  endpoint: "localhost",
  port: 9000,
  useSSL: false,
  accessKey: "key",
  secretKey: "secret",
  bucket: "wayfinder-documents",
  region: "",
  pathStyle: true,
  ...overrides,
});

const serviceError = (name: string, httpStatusCode: number): S3ServiceException =>
  new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode } });

describe("s3ClientConfig", () => {
  it("builds the endpoint from the host, port and scheme", () => {
    expect(s3ClientConfig(config()).endpoint).toBe("http://localhost:9000");
    expect(s3ClientConfig(config({ endpoint: "s3.ap-southeast-2.amazonaws.com", port: 443, useSSL: true })).endpoint).toBe(
      "https://s3.ap-southeast-2.amazonaws.com:443",
    );
  });

  it("carries the credentials and the addressing style through", () => {
    const built = s3ClientConfig(config({ pathStyle: false }));

    expect(built.credentials).toEqual({ accessKeyId: "key", secretAccessKey: "secret" });
    expect(built.forcePathStyle).toBe(false);
  });

  it("signs with a configured region and does not chase redirects", () => {
    const built = s3ClientConfig(config({ region: "eu-west-2" }));

    expect(built.region).toBe("eu-west-2");
    expect(built.followRegionRedirects).toBe(false);
  });

  // A blank region used to mean "discover it per bucket". The SDK needs a
  // region to sign with, so it starts from us-east-1 (what S3-compatible
  // servers expect) and follows S3's redirect to the bucket's real region.
  it("starts from us-east-1 and follows region redirects when no region is set", () => {
    const built = s3ClientConfig(config({ region: "" }));

    expect(built.region).toBe("us-east-1");
    expect(built.followRegionRedirects).toBe(true);
  });

  // The SDK's default sends a CRC32 checksum on every upload, which not every
  // S3-compatible server accepts. Wayfinder only ever ran on checksums S3 itself
  // requires.
  it("sends and validates checksums only when the operation requires them", () => {
    const built = s3ClientConfig(config());

    expect(built.requestChecksumCalculation).toBe("WHEN_REQUIRED");
    expect(built.responseChecksumValidation).toBe("WHEN_REQUIRED");
  });
});

describe("isNotFound", () => {
  it("recognises S3's not-found answers", () => {
    expect(isNotFound(serviceError("NotFound", 404))).toBe(true);
    expect(isNotFound(serviceError("NoSuchKey", 404))).toBe(true);
    expect(isNotFound(serviceError("NoSuchBucket", 404))).toBe(true);
  });

  // HEAD responses carry no body, so some servers answer with only the status.
  it("recognises a bare 404", () => {
    expect(isNotFound(serviceError("Unknown", 404))).toBe(true);
  });

  it("does not mistake other failures for a missing object", () => {
    expect(isNotFound(serviceError("AccessDenied", 403))).toBe(false);
    expect(isNotFound(new Error("connect ECONNREFUSED"))).toBe(false);
  });
});

describe("bucketExists", () => {
  const senderAnswering = (answer: () => Promise<unknown>) => {
    const sent: unknown[] = [];
    const sender: S3Sender = {
      send: async (command: unknown) => {
        sent.push(command);
        return answer();
      },
    } as S3Sender;
    return { sender, sent };
  };

  it("is true when the bucket answers a HEAD", async () => {
    const { sender, sent } = senderAnswering(async () => ({}));

    expect(await bucketExists(sender, "wayfinder-documents")).toBe(true);
    expect(sent[0]).toBeInstanceOf(HeadBucketCommand);
    expect((sent[0] as HeadBucketCommand).input).toEqual({ Bucket: "wayfinder-documents" });
  });

  it("is false when the bucket is missing", async () => {
    const { sender } = senderAnswering(async () => {
      throw serviceError("NotFound", 404);
    });

    expect(await bucketExists(sender, "wayfinder-documents")).toBe(false);
  });

  it("rethrows anything else, so an outage is not reported as a missing bucket", async () => {
    const { sender } = senderAnswering(async () => {
      throw serviceError("AccessDenied", 403);
    });

    await expect(bucketExists(sender, "wayfinder-documents")).rejects.toMatchObject({ name: "AccessDenied" });
  });
});
