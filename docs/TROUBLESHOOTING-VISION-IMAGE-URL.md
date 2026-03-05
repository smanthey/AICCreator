# Troubleshooting: Empty image_url / Vision API Errors

## Error

```text
Error running remote compact task: {
  "error": {
    "message": "Invalid 'input[566].content[2].image_url'. Expected a base64-encoded data URL with an image MIME type (e.g. 'data:image/png;base64,...'), but got empty base64-encoded bytes.",
    "type": "invalid_request_error",
    "param": "input[566].content[2].image_url",
    "code": "invalid_value"
  }
}
```

## Cause

The vision API (OpenAI or compatible) was sent a message content block with `type: "image_url"` and `image_url.url` set to a data URL whose **base64 payload is empty** (e.g. `data:image/png;base64,` with nothing after the comma). APIs reject this.

Common causes:

- An image attachment failed to load or encode (e.g. in Codex or another client).
- A file read returned empty bytes (0-byte file or read error).
- A placeholder or fallback was sent as an empty string.

## Fixes in this repo

- **`agents/media-visual-agent.js`**
  Before calling the vision API we now:
  - Skip files with `stat.size === 0`.
  - Skip when `b64` from `readFileSync(…).toString("base64")` is empty.
  So we never send an `image_url` with empty base64.

## If you see this in Codex (or another client)

The request is being built by the **client** (e.g. Codex when running a “remote compact task” with git context and images). To avoid the error:

1. **Remove or re-add images**
   If the task includes screenshots or pasted images, remove them and retry, or re-attach so no image is empty.

2. **Retry without image context**
   Run the same task without attaching images (e.g. code-only or text-only context) to confirm the task works.

3. **Report to the client**
   If the client is Codex/Codeium (or similar), report that it sometimes sends `image_url` with empty base64 so they can validate/filter before calling the API.

## Building payloads correctly

When you build vision request content in this repo:

- Never add a content block `{ type: "image_url", image_url: { url: "…" } }` unless the URL is a valid data URL with **non-empty** base64, e.g. `data:image/png;base64,<non-empty>`.
- If a file is 0 bytes or read fails, **omit the image block** or skip that item instead of sending an empty string.
