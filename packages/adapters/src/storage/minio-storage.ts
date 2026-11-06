import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { domainError, err, ok, type StorageConfig } from "@wayfinder/domain";
import type { IObjectStorage } from "@wayfinder/domain";
import type { Result } from "@wayfinder/domain";
import { RuntimeConfigStore } from "../config/runtime-config-store";
import { bucketExists, createS3Client, isNotFound, type S3Sender } from "./s3-client";

// Named for the MINIO_* settings it reads. It speaks plain S3, so it serves
// Amazon S3, SeaweedFS and MinIO alike.
export class MinioStorageAdapter implements IObjectStorage {
  private cachedClient: { client: S3Sender; bucket: string; version: number } | null = null;

  constructor(
    private readonly runtimeConfig: RuntimeConfigStore,
    private readonly createClient: (config: StorageConfig) => S3Sender = createS3Client,
  ) {}

  private async resolveClient(): Promise<{ client: S3Sender; bucket: string }> {
    const config = await this.runtimeConfig.getStorageConfig();
    const version = this.runtimeConfig.getStorageVersion();
    if (this.cachedClient && this.cachedClient.version === version) {
      return { client: this.cachedClient.client, bucket: this.cachedClient.bucket };
    }
    const client = this.createClient(config);
    this.cachedClient = { client, bucket: config.bucket, version };
    return { client, bucket: config.bucket };
  }

  async initialise(): Promise<void> {
    const { client, bucket } = await this.resolveClient();
    if (await bucketExists(client, bucket)) return;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<Result<{ key: string }>> {
    try {
      const { client, bucket } = await this.resolveClient();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentLength: data.length,
          ContentType: mimeType,
        }),
      );
      return ok({ key });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to store object at key ${key}.`, cause));
    }
  }

  async get(key: string): Promise<Result<Buffer>> {
    try {
      const { client, bucket } = await this.resolveClient();
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) {
        return err(domainError("INFRA_FAILURE", `Object at key ${key} came back with no body.`));
      }
      return ok(Buffer.from(await response.Body.transformToByteArray()));
    } catch (cause) {
      if (isNotFound(cause)) {
        return err(domainError("NOT_FOUND", `Object not found at key ${key}.`, cause));
      }
      return err(domainError("INFRA_FAILURE", `Failed to retrieve object at key ${key}.`, cause));
    }
  }

  async delete(key: string): Promise<Result<void>> {
    try {
      const { client, bucket } = await this.resolveClient();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to delete object at key ${key}.`, cause));
    }
  }

  async exists(key: string): Promise<Result<boolean>> {
    try {
      const { client, bucket } = await this.resolveClient();
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return ok(true);
    } catch (cause) {
      if (isNotFound(cause)) return ok(false);
      return err(domainError("INFRA_FAILURE", `Failed to check existence of object at key ${key}.`, cause));
    }
  }
}
