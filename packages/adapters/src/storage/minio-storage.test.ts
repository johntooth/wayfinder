import { describe, it, expect } from "vitest";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { ok, type ISystemSettingsRepository, type Result, type SystemSetting } from "@wayfinder/domain";
import { MinioStorageAdapter } from "./minio-storage";
import type { S3Sender } from "./s3-client";
import { RuntimeConfigStore } from "../config/runtime-config-store";

const stubSettingsRepo: ISystemSettingsRepository = {
  async get(): Promise<Result<SystemSetting | null>> {
    return ok(null);
  },
  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    return ok({ key, value, createdAt: new Date(), updatedAt: new Date() });
  },
  async delete(): Promise<Result<void>> {
    return ok(undefined);
  },
};

const notFound = (name: string) =>
  new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: 404 } });

type Answer = (command: unknown) => unknown;

// A stand-in S3 endpoint: records every command and answers it with `answer`.
const makeAdapter = (answer: Answer = () => ({})) => {
  const sent: unknown[] = [];
  const sender = {
    send: async (command: unknown) => {
      sent.push(command);
      return answer(command);
    },
  } as S3Sender;
  const store = new RuntimeConfigStore(stubSettingsRepo, {
    provider: "anthropic",
    apiKeys: { anthropic: null, openai: null, mistral: null },
    storage: {
      endpoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "minioadmin",
      secretKey: "minioadmin",
      bucket: "wayfinder-documents",
      region: "",
      pathStyle: true,
    },
  });
  return { adapter: new MinioStorageAdapter(store, () => sender), sent };
};

describe("MinioStorageAdapter", () => {
  describe("initialise", () => {
    it("creates the bucket when it does not exist", async () => {
      const { adapter, sent } = makeAdapter((command) => {
        if (command instanceof HeadBucketCommand) throw notFound("NotFound");
        return {};
      });

      await adapter.initialise();

      expect(sent[0]).toBeInstanceOf(HeadBucketCommand);
      expect(sent[1]).toBeInstanceOf(CreateBucketCommand);
      expect((sent[1] as CreateBucketCommand).input).toEqual({ Bucket: "wayfinder-documents" });
    });

    it("skips bucket creation when it already exists", async () => {
      const { adapter, sent } = makeAdapter();

      await adapter.initialise();

      expect(sent).toHaveLength(1);
      expect(sent[0]).toBeInstanceOf(HeadBucketCommand);
    });

    it("propagates the error when the storage server is unreachable", async () => {
      const connectionError = Object.assign(new AggregateError([new Error("connect ECONNREFUSED")]), {
        code: "ECONNREFUSED",
      });
      const { adapter } = makeAdapter(() => {
        throw connectionError;
      });

      await expect(adapter.initialise()).rejects.toMatchObject({ code: "ECONNREFUSED" });
    });
  });

  describe("put", () => {
    it("stores an object and returns the key", async () => {
      const { adapter, sent } = makeAdapter();
      const data = Buffer.from("hello world");

      const result = await adapter.put("templates/node1/file.docx", data, "application/octet-stream");

      expect(result.error).toBeUndefined();
      expect(result.data).toEqual({ key: "templates/node1/file.docx" });
      expect(sent[0]).toBeInstanceOf(PutObjectCommand);
      expect((sent[0] as PutObjectCommand).input).toEqual({
        Bucket: "wayfinder-documents",
        Key: "templates/node1/file.docx",
        Body: data,
        ContentLength: data.length,
        ContentType: "application/octet-stream",
      });
    });

    it("returns an error when put fails", async () => {
      const { adapter } = makeAdapter(() => {
        throw new Error("network error");
      });

      const result = await adapter.put("templates/node1/file.docx", Buffer.from("data"), "application/octet-stream");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("get", () => {
    it("retrieves an object as a Buffer", async () => {
      const { adapter, sent } = makeAdapter(() => ({
        Body: { transformToByteArray: async () => new TextEncoder().encode("file content") },
      }));

      const result = await adapter.get("generated/session1/doc.docx");

      expect(result.error).toBeUndefined();
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data?.toString()).toBe("file content");
      expect((sent[0] as GetObjectCommand).input).toEqual({
        Bucket: "wayfinder-documents",
        Key: "generated/session1/doc.docx",
      });
    });

    it("returns NOT_FOUND when the object does not exist", async () => {
      const { adapter } = makeAdapter(() => {
        throw notFound("NoSuchKey");
      });

      const result = await adapter.get("generated/session1/missing.docx");

      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("returns an error when the response carries no body", async () => {
      const { adapter } = makeAdapter(() => ({}));

      const result = await adapter.get("generated/session1/doc.docx");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("delete", () => {
    it("removes the object successfully", async () => {
      const { adapter, sent } = makeAdapter();

      const result = await adapter.delete("context/flow1/doc.pdf");

      expect(result.error).toBeUndefined();
      expect(sent[0]).toBeInstanceOf(DeleteObjectCommand);
      expect((sent[0] as DeleteObjectCommand).input).toEqual({
        Bucket: "wayfinder-documents",
        Key: "context/flow1/doc.pdf",
      });
    });

    it("returns an error when removal fails", async () => {
      const { adapter } = makeAdapter(() => {
        throw new Error("permission denied");
      });

      const result = await adapter.delete("context/flow1/doc.pdf");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("exists", () => {
    it("returns true when the object exists", async () => {
      const { adapter, sent } = makeAdapter(() => ({ ContentLength: 1024 }));

      const result = await adapter.exists("templates/node1/template.docx");

      expect(result.data).toBe(true);
      expect(sent[0]).toBeInstanceOf(HeadObjectCommand);
    });

    it("returns false when the object does not exist", async () => {
      const { adapter } = makeAdapter(() => {
        throw notFound("NotFound");
      });

      const result = await adapter.exists("templates/node1/missing.docx");

      expect(result.error).toBeUndefined();
      expect(result.data).toBe(false);
    });

    it("returns an error rather than false when the check itself fails", async () => {
      const { adapter } = makeAdapter(() => {
        throw new Error("connect ECONNREFUSED");
      });

      const result = await adapter.exists("templates/node1/template.docx");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });
});
