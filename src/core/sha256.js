// SHA-256, pure and synchronous (REQ-307, PAT-DEC-04, ADR-0004).
//
// Why not crypto.subtle: it is asynchronous and secure-context-only. Boot integrity
// verification must not gain an await point (02-architecture.md §6), the test harness must
// run under plain Node, and reconciliation hashes per comparison.
//
// Hand-written cryptography is a bug source, so the mitigation is a vector test: the build
// verifies this implementation against the published NIST vectors before it will produce an
// artifact, and the test suite runs the same vectors (09-testing.md).

TP.sha256 = (function () {
  'use strict';

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  // UTF-8 encode a JS string to bytes. Lone surrogates become U+FFFD, matching what
  // TextEncoder does, so a hash computed here and one computed by a browser agree.
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        var d = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
        if (d >= 0xdc00 && d <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i++;
        } else {
          out.push(0xef, 0xbf, 0xbd);
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        out.push(0xef, 0xbf, 0xbd);
      } else if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  function digestBytes(data) {
    var H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    var len = data.length;
    var bits = len * 8;
    // Padded length: message + 0x80 + zeros + 8-byte big-endian bit length, multiple of 64.
    var padded = len + 1;
    while (padded % 64 !== 56) padded++;
    var buf = new Uint8Array(padded + 8);
    buf.set(data, 0);
    buf[len] = 0x80;
    var hi = Math.floor(bits / 4294967296);
    var lo = bits >>> 0;
    buf[padded] = (hi >>> 24) & 0xff; buf[padded + 1] = (hi >>> 16) & 0xff;
    buf[padded + 2] = (hi >>> 8) & 0xff; buf[padded + 3] = hi & 0xff;
    buf[padded + 4] = (lo >>> 24) & 0xff; buf[padded + 5] = (lo >>> 16) & 0xff;
    buf[padded + 6] = (lo >>> 8) & 0xff; buf[padded + 7] = lo & 0xff;

    var w = new Uint32Array(64);
    for (var off = 0; off < buf.length; off += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        w[i] = ((buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) |
                (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var out = new Uint8Array(32);
    for (var j = 0; j < 8; j++) {
      out[j * 4] = (H[j] >>> 24) & 0xff; out[j * 4 + 1] = (H[j] >>> 16) & 0xff;
      out[j * 4 + 2] = (H[j] >>> 8) & 0xff; out[j * 4 + 3] = H[j] & 0xff;
    }
    return out;
  }

  var HEX = '0123456789abcdef';

  function hexOf(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    return s;
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64Of(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      s += B64[b0 >> 2];
      s += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      s += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      s += b2 === undefined ? '=' : B64[b2 & 63];
    }
    return s;
  }

  // Published NIST / FIPS 180-4 vectors, including the 448-bit and 896-bit padding
  // boundaries that a naive implementation gets wrong.
  var VECTORS = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
  ];

  function hex(str) { return hexOf(digestBytes(utf8Bytes(str))); }
  function base64(str) { return base64Of(digestBytes(utf8Bytes(str))); }

  // Runs on every build (REQ-307) and in the suite (09-testing.md). Throws on any mismatch.
  function verifyVectors() {
    for (var i = 0; i < VECTORS.length; i++) {
      var got = hex(VECTORS[i][0]);
      if (got !== VECTORS[i][1]) {
        throw new Error('SHA-256 vector ' + i + ' failed: expected ' + VECTORS[i][1] + ', got ' + got);
      }
    }
    // The million-'a' vector, as a long-input check.
    var big = new Array(1000001).join('a');
    var gotBig = hex(big);
    if (gotBig !== 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0') {
      throw new Error('SHA-256 million-a vector failed: got ' + gotBig);
    }
    return true;
  }

  return {
    hex: hex,
    base64: base64,
    digestBytes: digestBytes,
    utf8Bytes: utf8Bytes,
    hexOf: hexOf,
    base64Of: base64Of,
    verifyVectors: verifyVectors,
  };
})();
