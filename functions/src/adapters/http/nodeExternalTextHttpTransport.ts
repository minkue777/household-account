import type {
  ExternalTextHttpTransportPort,
  ExternalTextHttpTransportRequest,
  ExternalTextHttpTransportResult,
} from "../../platform/external-operations/application/ports/out/externalTextHttpTransportPort";

function decoderFor(contentType: string | null): TextDecoder {
  const charset = contentType
    ?.match(/charset\s*=\s*["']?([^;"']+)/iu)?.[1]
    ?.trim()
    .toLowerCase();
  try {
    return new TextDecoder(charset ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<ExternalTextHttpTransportResult> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    return { kind: "response-too-large", bodyBytes: declared };
  }
  if (response.body === null) {
    return {
      kind: "response",
      status: response.status,
      body: "",
      bodyBytes: 0,
      ...(response.headers.get("location") === null
        ? {}
        : { location: response.headers.get("location")! }),
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maxResponseBytes) {
      await reader.cancel();
      return { kind: "response-too-large", bodyBytes: bytes };
    }
    chunks.push(next.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    kind: "response",
    status: response.status,
    body: decoderFor(response.headers.get("content-type")).decode(combined),
    bodyBytes: bytes,
    ...(response.headers.get("location") === null
      ? {}
      : { location: response.headers.get("location")! }),
  };
}

export class NodeExternalTextHttpTransport
  implements ExternalTextHttpTransportPort
{
  async execute(
    request: ExternalTextHttpTransportRequest,
  ): Promise<ExternalTextHttpTransportResult> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
        signal: abort.signal,
      });
      return await readBoundedBody(response, request.maxResponseBytes);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { kind: "timeout" };
      }
      return { kind: "network-failure", code: "FETCH_FAILED" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
