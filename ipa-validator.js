/* Structural IPA validation only. This does not verify Apple signing or provisioning. */
(function () {
  async function validateIPA(file) {
    if (!file || !/\.ipa$/i.test(file.name || '')) throw new Error('Chỉ chấp nhận file có đuôi .ipa.');
    if (file.size < 22) throw new Error('File quá nhỏ hoặc không phải gói IPA hợp lệ.');
    const header = new DataView(await file.slice(0, 4).arrayBuffer());
    if (header.getUint32(0, true) !== 0x04034b50) throw new Error('File không có cấu trúc ZIP của gói IPA. Đổi đuôi file không tạo thành IPA.');
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
    const view = new DataView(tail.buffer);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === tail.length) { end = i; break; }
    }
    if (end < 0) throw new Error('Gói IPA bị thiếu dữ liệu hoặc không có ZIP directory hợp lệ.');
    const entries = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    const directoryOffset = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || entries === 65535 || directoryOffset === 0xffffffff) throw new Error('Công cụ chưa hỗ trợ IPA dạng ZIP64 hoặc chia nhiều phần.');
    if (directorySize > 32 * 1024 * 1024 || directoryOffset + directorySize > file.size - 22) throw new Error('Cấu trúc thư mục trong IPA không hợp lệ.');
    const directory = new DataView(await file.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer());
    let offset = 0;
    let found = false;
    for (let i = 0; i < entries; i++) {
      if (offset + 46 > directory.byteLength || directory.getUint32(offset, true) !== 0x02014b50) throw new Error('Không đọc được danh sách tệp trong IPA.');
      const nameLength = directory.getUint16(offset + 28, true);
      const extraLength = directory.getUint16(offset + 30, true);
      const commentLength = directory.getUint16(offset + 32, true);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > directory.byteLength) throw new Error('Danh sách tệp IPA bị cắt ngắn.');
      const name = new TextDecoder().decode(new Uint8Array(directory.buffer, offset + 46, nameLength));
      if (/^Payload\/[^/]+\.app\/Info\.plist$/.test(name)) found = true;
      offset = next;
    }
    if (!found) throw new Error('Không tìm thấy Payload/*.app/Info.plist. Đây chưa phải gói ứng dụng iOS.');
    return true;
  }
  globalThis.validateIPA = validateIPA;
})();
