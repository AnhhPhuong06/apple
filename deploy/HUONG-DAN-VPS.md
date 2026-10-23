# Đưa AppSpace lên VPS Ubuntu

Gói có đầy đủ trang admin, trang cài app, hỗ trợ JPG/PNG và logo bằng link. Có kèm các app đã xuất công khai trong `public-apps/` (hiện tại là Nro Han). **Không chứa mật khẩu, file .p12, .mobileprovision hay dữ liệu riêng trên máy cá nhân.** VPS tạo mật khẩu admin mới.

## 1. Chuẩn bị

- Ubuntu Server **24.04 LTS x64**, 2 vCPU / 2 GB RAM, SSD từ 25 GB. Installer cũng chấp nhận Ubuntu 22.04 x64.
- SSH với quyền root hoặc sudo; VPS cần kết nối Internet để tải Node.js, thư viện và zsign.
- Một tên miền/subdomain, ví dụ `apps.tenmiencuaban.com`, có bản ghi **A** trỏ tới IP VPS. Nếu có bản ghi AAAA, IPv6 phải trỏ đúng VPS; nếu không dùng IPv6 thì bỏ AAAA.
- Cho phép cổng **80/TCP và 443/TCP** trong firewall của nhà cung cấp và UFW nếu đang bật. Giữ cổng SSH hiện tại. Installer không tự thay đổi firewall.
- Dùng VPS mới; nếu đã có Nginx/Apache trên cổng 80/443, cấu hình proxy hiện có thay vì chạy thêm Caddy trên cùng cổng.

## 2. Tải gói lên VPS

Trên Windows, dùng WinSCP hoặc lệnh PowerShell; thay IP và tên tài khoản SSH:

```powershell
scp D:\WebApple\packages\appspace-vps.tar.gz root@IP_VPS:/root/
```

Đăng nhập VPS, giải nén rồi cài:

```bash
ssh root@IP_VPS
cd /root
tar -xzf appspace-vps.tar.gz
cd appspace-vps
sudo bash deploy/install-ubuntu.sh apps.tenmiencuaban.com
```

**Thay `apps.tenmiencuaban.com` bằng tên miền thật của bạn**, không thêm `https://` hay `/admin`. Với tài khoản thường, upload vào thư mục home của tài khoản đó và giải nén tại đó trước khi chạy sudo.

Script cài Node.js 24.22.1 từ nguồn chính thức có kiểm tra SHA-256, dependencies từ lockfile, zsign Linux, Caddy HTTPS và dịch vụ systemd. Mỗi lần triển khai có thư mục mã riêng; cấu hình và dữ liệu tách riêng nên không bị ghi đè khi cập nhật.

## 3. Đăng nhập

- Admin: `https://apps.tenmiencuaban.com/admin`
- Kho ứng dụng công khai: `https://apps.tenmiencuaban.com/`
- Xem mật khẩu admin mới trên VPS:

```bash
sudo cat /etc/appspace/admin-password.txt
```

Mật khẩu không in vào log cài đặt. Chứng chỉ HTTPS được Caddy cấp tự động khi DNS và cổng 80/443 đúng. Trên VPS chỉ dùng IP, bạn có thể kiểm tra backend qua `curl http://127.0.0.1:4173/healthz`; để đăng nhập/cài OTA qua mạng, hãy hoàn tất tên miền HTTPS.

App Nro Han đi kèm được nhập một lần, link IPA/icon/manifest được đổi sang tên miền VPS. App cùng ID đã tồn tại sẽ được giữ nguyên. Các link GitHub Pages cũ vẫn hoạt động ở Pages. Chứng chỉ ký riêng của bạn cần chọn lại trong admin khi ký app mới.

## 4. Quản lý dịch vụ

```bash
sudo systemctl status appspace --no-pager
sudo journalctl -u appspace -n 80 --no-pager
sudo systemctl restart appspace
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 80 --no-pager
```

Dịch vụ tự chạy sau khi VPS khởi động. Chỉ restart hoặc cập nhật khi không có phiên ký đang chạy. Nếu HTTPS chưa lên, kiểm tra DNS, firewall và log Caddy. Không cần mở cổng 4173 ra Internet.

Vị trí chính:

- Mã đang chạy: `/opt/appspace/current`
- Node.js riêng: `/opt/appspace/node`
- Dữ liệu app và logo: `/var/lib/appspace`
- Biến môi trường: `/etc/appspace/appspace.env` (chỉ root đọc)
- HTTPS: `/etc/caddy/appspace.d/appspace.caddy`
- Các release cũ: `/opt/appspace/releases` (giữ lại để khôi phục; dọn thủ công khi cần dung lượng).

## 5. Cập nhật và sao lưu

Đóng gói bản mới, tải lên, giải nén vào thư mục mới và chạy lại installer với **cùng tên miền**. Script giữ mật khẩu, logo, app đã ký; nó kiểm tra không có phiên ký trước khi khởi động lại. Nếu backend mới không sẵn sàng, script trỏ lại release trước.

Từ bản 1.1, admin có hai chế độ thêm app (ký mới hoặc đăng IPA đã ký) và nút **Xóa app** ở danh sách. Khi xóa, IPA, ảnh, manifest và link của bản đó được gỡ khỏi máy chủ. Dấu xóa trong `/var/lib/appspace/deleted-apps` giúp installer không nhập lại app đã gỡ khi cập nhật. Bản sao trên GitHub Pages/Releases cần gỡ riêng.

Sao lưu khi không có phiên ký; file backup chứa mật khẩu admin nên giữ riêng:

```bash
sudo systemctl stop appspace
sudo tar -czf /root/appspace-backup.tar.gz -C / var/lib/appspace etc/appspace
sudo chmod 600 /root/appspace-backup.tar.gz
sudo systemctl start appspace
```

Đổi tên miền sau khi đã ký sẽ cần cập nhật manifest và các link cũ. Installer từ chối đổi domain vô tình. Muốn dùng cùng IP cho nhiều website, hãy quản lý Caddy/Nginx chủ động để tránh trùng cổng hoặc domain.

## 6. Đóng gói lại từ mã nguồn

```powershell
npm.cmd run package:vps
```

Kết quả trong `packages/`: `appspace-vps.tar.gz`, `appspace-vps.zip`, hướng dẫn và file SHA-256. Cả hai archive có cùng nội dung. Các script trong archive luôn dùng xuống dòng Linux LF.

Tài liệu chính thức: [Node.js](https://nodejs.org/en/download), [Caddy trên Linux](https://caddyserver.com/docs/running), [zsign](https://github.com/zhlynn/zsign/tree/v1.1.3).
