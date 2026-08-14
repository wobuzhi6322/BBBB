export type SharedMediaFile = {
  kind: string;
  filename: string;
  size: number;
  updatedAt: string;
  storagePath: string;
};

type SignedUploadData = {
  signedUrl: string;
  token: string;
};

type SignedDownloadData = {
  path: string | null;
  signedUrl: string | null;
  signedURL?: string | null;
  error?: string | null;
};

type StorageResult<T> = Promise<{
  data: T | null;
  error: unknown;
}>;

export type SharedProfileStorage = {
  createSignedUploadUrl(
    storagePath: string,
    options: { upsert: boolean }
  ): StorageResult<SignedUploadData>;
  createSignedUrls(
    storagePaths: string[],
    expiresIn: number
  ): StorageResult<SignedDownloadData[]>;
};

export type SignedUploadTarget = SharedMediaFile & SignedUploadData;
export type SignedDownloadTarget = SharedMediaFile & {
  signedUrl: string;
};

export const uploadSigningConcurrency = 12;

export async function createSignedUploadTargets(
  storage: SharedProfileStorage,
  mediaFiles: SharedMediaFile[]
): Promise<SignedUploadTarget[]> {
  return mapConcurrent(mediaFiles, uploadSigningConcurrency, async (file) => {
    const { data, error } = await storage.createSignedUploadUrl(
      file.storagePath,
      { upsert: true }
    );
    if (error || !data) {
      throw new Error(errorMessage(
        error,
        `failed to create signed upload url for ${file.filename}`
      ));
    }
    return {
      ...file,
      signedUrl: data.signedUrl,
      token: data.token
    };
  });
}

export async function createSignedDownloadTargets(
  storage: SharedProfileStorage,
  mediaFiles: SharedMediaFile[],
  expiresIn: number
): Promise<SignedDownloadTarget[]> {
  if (mediaFiles.length === 0) {
    return [];
  }

  const { data, error } = await storage.createSignedUrls(
    mediaFiles.map((file) => file.storagePath),
    expiresIn
  );
  if (error || !data) {
    throw new Error(errorMessage(error, "failed to create signed download urls"));
  }

  const signedByPath = new Map(
    data
      .filter((signed): signed is SignedDownloadData & { path: string } => typeof signed.path === "string")
      .map((signed) => [signed.path, signed])
  );
  return mediaFiles.map((file) => {
    const signed = signedByPath.get(file.storagePath);
    const signedUrl = signed?.signedUrl || signed?.signedURL;
    if (!signedUrl || signed.error) {
      throw new Error(signed?.error || `failed to create signed download url for ${file.filename}`);
    }
    return {
      ...file,
      signedUrl
    };
  });
}

async function mapConcurrent<Input, Output>(
  values: Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>
): Promise<Output[]> {
  if (values.length === 0) {
    return [];
  }

  const output = new Array<Output>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await transform(values[index]);
    }
  };
  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return output;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
    && error.message
  ) {
    return error.message;
  }
  return fallback;
}
