import assert from "node:assert/strict";
import test from "node:test";
import { FILE_CONTENT_SECURITY_POLICY, fileDisposition, fileResponseHeaders } from "../dist/file-response.js";

const CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

function expectInline(mime, name) {
  const headers = fileResponseHeaders(mime, name);
  assert.match(headers["content-disposition"], /^inline;/, mime);
  assert.match(headers["content-disposition"], new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(headers["x-content-type-options"], "nosniff", mime);
  assert.equal(headers["content-security-policy"], CSP, mime);
}

function expectAttachment(mime, name) {
  const headers = fileResponseHeaders(mime, name);
  assert.match(fileDisposition(mime, name), /^attachment;/, mime);
  assert.match(headers["content-disposition"], /^attachment;/, mime);
  assert.equal(headers["x-content-type-options"], "nosniff", mime);
  assert.equal(headers["content-security-policy"], CSP, mime);
}

test("raster images and video are inline; svg and other files download", () => {
  assert.equal(FILE_CONTENT_SECURITY_POLICY, CSP);
  expectInline("image/png", "dot.png");
  expectInline("image/jpeg", "photo.jpg");
  expectInline("image/webp", "photo.webp");
  expectInline("image/gif", "anim.gif");
  expectInline("video/mp4", "clip.mp4");
  expectInline("video/webm", "clip.webm");
  expectInline("IMAGE/PNG", "dot.png");
  expectInline("image/jpeg; charset=binary", "photo.jpg");
  expectInline("video/mp4; codecs=avc1", "clip.mp4");

  expectAttachment("image/svg+xml", "icon.svg");
  expectAttachment("image/svg+xml; charset=utf-8", "icon.svg");
  expectAttachment("image/svg", "icon.svg");
  expectAttachment("IMAGE/SVG+XML", "icon.svg");
  expectAttachment("application/octet-stream", "blob.bin");
  expectAttachment("text/html", "page.html");
  expectAttachment("text/csv", "status.csv");
  expectAttachment("", "file");

  assert.match(fileDisposition("video/mp4", 'clip".mp4'), /^inline; filename="clip\.mp4"$/);
  assert.match(fileDisposition("image/svg+xml", "icon.svg"), /^attachment; filename="icon\.svg"$/);
});
