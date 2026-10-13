import QRCode from 'qrcode';
import { deflate, inflate } from 'pako';
import jsQR from 'jsqr';

// Payload format version. Bump if the shape of the encoded referral card changes.
const PAYLOAD_VERSION = 1;

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Referral card payload is self-contained: no server lookup is needed to read it,
 * since the CHC end may have zero connectivity when the QR is scanned.
 */
export function buildReferralPayload(visit) {
  return {
    v: PAYLOAD_VERSION,
    id: visit.localId,
    ts: visit.createdAt,
    name: visit.name,
    age: visit.age,
    gender: visit.gender,
    abha: visit.abhaId || null,
    phc: visit.facility,
    sym: visit.symptoms,
    dx: visit.diagnosis,
    meds: visit.medications,
    all: visit.allergies,
    notes: visit.notes,
  };
}

export function encodePayload(payload) {
  const json = JSON.stringify(payload);
  const compressed = deflate(new TextEncoder().encode(json));
  return 'SETHU1:' + toBase64Url(compressed);
}

export function decodePayload(text) {
  if (!text || !text.startsWith('SETHU1:')) {
    throw new Error('Not a recognised Sethu referral card.');
  }
  const bytes = fromBase64Url(text.slice('SETHU1:'.length));
  const json = new TextDecoder().decode(inflate(bytes));
  return JSON.parse(json);
}

export async function payloadToDataUrl(payload) {
  const text = encodePayload(payload);
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 360,
  });
}

export function payloadCharCount(payload) {
  return encodePayload(payload).length;
}

/**
 * Decode a QR code from an uploaded image file, entirely offline and client-side.
 * Uses jsQR directly (with image smoothing disabled) rather than html5-qrcode's
 * static-image scan path, which draws through a canvas with smoothing enabled —
 * that blurs the crisp module edges of a small/synthetic QR enough to make its
 * bundled ZXing decoder (which runs without "try harder") miss codes that a
 * camera-photographed, printed card would not trigger.
 */
export async function decodeQrFromImageFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const result = jsQR(imageData.data, imageData.width, imageData.height);
  if (!result) {
    throw new Error('No QR code detected in this image.');
  }
  return result.data;
}
