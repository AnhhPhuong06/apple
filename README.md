# AppSpace Sign

Ký IPA ngay trên web bằng chứng chỉ `.p12` và hồ sơ `.mobileprovision`, sau đó tạo trang cài đặt riêng theo phong cách App Store. Giao diện tiếng Việt, dùng được trên điện thoại và máy tính.

## Chạy trên máy

Cần Node.js 24 trở lên. Trong PowerShell:

```powershell
npm.cmd ci
npm.cmd run setup:signer
npm.cmd start
```

Mở **http://127.0.0.1:4173/admin** để đăng nhập và ký app. Trang chủ **http://127.0.0.1:4173/** là trang ứng dụng công khai.

Nếu chưa đặt `ADMIN_TOKEN`, lần khởi động đầu tiên sẽ tạo mật khẩu ngẫu nhiên trong **`data/admin-key.txt`** (hoặc `DATA_DIR/admin-key.txt`). Mở tệp này trên máy chủ, sao chép mật khẩu vào màn hình đăng nhập. Tệp mật khẩu không được phục vụ qua HTTP hay đưa vào Git. Bạn có thể đặt mật khẩu riêng dài ít nhất 24 ký tự bằng `ADMIN_TOKEN` trong `.env`, rồi khởi động lại máy chủ.

Trang ký và các API ký, trạng thái phiên, trạng thái công cụ đều yêu cầu đăng nhập, kể cả khi chạy cục bộ. Phiên đăng nhập kéo dài 12 giờ, lưu bằng cookie HttpOnly/SameSite, bật Secure khi dùng tên miền HTTPS; đăng xuất hoặc khởi động lại máy chủ sẽ hủy phiên. API tự động hóa vẫn có thể dùng `Authorization: Bearer <ADMIN_TOKEN>`.

Trang cài `index.html?job=<id>`, thông tin app, ảnh, manifest và IPA đầu ra đều công khai: người nhận link không cần tài khoản, chứng chỉ hay mật khẩu admin. Trang công khai không có nút ký app hoặc liên kết quản trị.

Trang chủ và `catalog.html` là kho ứng dụng: mỗi app có tên, icon, phiên bản và link cài riêng, hỗ trợ tìm kiếm không dấu, lọc danh mục và sắp xếp. Danh sách chỉ hiển thị app thật đã ký trên máy chủ, hoặc các app đã xuất khi chạy trên Pages. Không có app thì hiển thị trạng thái trống.

Trong admin, phần **Ứng dụng đã tạo** liệt kê các app đã lưu. Bạn có thể tìm app, mở trang cài, sao chép link và xóa app; danh sách vẫn có sau khi khởi động lại. Nút **Thêm app mới** xóa thông tin trong biểu mẫu để nhập app tiếp theo. Mỗi app có UUID và link riêng, kể cả khi trùng tên.

## Thêm và xóa ứng dụng trong admin

- **Ký & thêm app**: giữ luồng ký IPA bằng `.p12` và `.mobileprovision`, có thể đổi tên, Bundle ID hoặc phiên bản trước khi ký.
- **Thêm IPA đã ký**: chỉ cần IPA, không cần chứng chỉ hay công cụ ký. Tên, phiên bản, Bundle ID và yêu cầu iOS được đọc từ gói; nội dung IPA được giữ nguyên. Bạn có thể bổ sung icon cho trang giới thiệu, mô tả, danh mục và ảnh xem trước. Máy chủ kiểm tra cấu trúc IPA, không xác nhận chữ ký hay khả năng chạy trên thiết bị.
- **Xóa app**: tại **Ứng dụng đã tạo**, bấm **Xóa app**, kiểm tra tên trong hộp xác nhận rồi chọn **Xóa ứng dụng**. App được gỡ khỏi danh sách công khai và xóa IPA, manifest, ảnh cùng metadata của đúng bản đó. Link tải/cài cũ của bản bị xóa trả về 404; các app khác được giữ lại.

Chỉ admin đã đăng nhập hoặc API có Bearer token hợp lệ được thêm/xóa app. Các API là `POST /api/admin/apps` (multipart: `ipa`, `icon`, `screenshots` và thông tin giới thiệu) và `DELETE /api/admin/apps/:id`. Phiên đăng nhập dùng cookie cần thêm header `X-AppSpace-Admin: 1` cho thao tác ghi. Phiên upload và phiên ký dùng chung giới hạn xử lý một app tại một thời điểm.

Việc xóa áp dụng trên máy chủ đang quản trị. Bản sao đã xuất lên GitHub Pages hoặc Releases cần được gỡ riêng tại repository tương ứng. Máy chủ lưu dấu xóa trong `DATA_DIR/deleted-apps/` để lần cập nhật VPS sau không tự nhập lại app đã gỡ, kể cả khi gói cài còn chứa bản xuất đó.

## Kho chứng chỉ và ký nhanh

Trong `/admin`, mở **Kho chứng chỉ → Lưu bộ chứng chỉ mới**, chọn `.p12`, `.mobileprovision`, nhập mật khẩu `.p12` nếu có và đặt tên dễ nhớ. Bấm **Lưu & kiểm tra chứng chỉ**. Lần ký sau chọn bộ đã lưu ở đầu biểu mẫu, chỉ tải IPA; không cần tải lại chứng chỉ hoặc nhập lại mật khẩu. Lựa chọn được giữ khi tạo app tiếp theo và tải lại tab admin. Chỉ ID bộ đã chọn nằm trong sessionStorage; mật khẩu và nội dung tệp không được lưu trong trình duyệt.

Kho dùng AES-256-GCM để mã hóa toàn bộ `.p12`, hồ sơ, mật khẩu và thông tin kiểm tra trong `DATA_DIR/certificates/*.vault`. Khóa ngẫu nhiên 32 byte nằm riêng tại `DATA_DIR/certificate-vault.key`, quyền 0600 trên Linux. Thư mục kho dùng quyền 0700. API chỉ trả thông tin kiểm tra, không cung cấp tệp chứng chỉ hoặc mật khẩu. Mật khẩu admin có thể đổi mà không đổi khóa kho. Quản trị viên hệ điều hành có quyền đọc cả khóa và kho vẫn có thể giải mã.

**Sao lưu cả DATA_DIR, gồm kho và khóa.** Mất khóa sẽ không thể mở lại chứng chỉ; khi kho còn dữ liệu nhưng khóa bị mất, máy chủ từ chối tạo khóa mới. Gói VPS, GitHub Releases và Pages không chứa kho, khóa hay tệp chứng chỉ. Cập nhật VPS giữ dữ liệu riêng trong `/var/lib/appspace`.

Nút **Check chứng chỉ** kiểm tra:

- Mở được `.p12` bằng mật khẩu và có khóa riêng khớp chứng chỉ.
- Chứng chỉ thuộc loại ký app iOS, chuỗi tin cậy đến Apple Root CA, còn trong thời hạn.
- Hồ sơ có chữ ký CMS hợp lệ từ chứng chỉ cấp provisioning profile của Apple; chứng chỉ, Team ID và phạm vi App ID khớp hồ sơ, hồ sơ còn hạn. Hồ sơ App Store không dùng để cài IPA trực tiếp qua website.
- OCSP tới địa chỉ Apple được cho phép trong chứng chỉ. Phản hồi chỉ được chấp nhận sau khi OpenSSL xác minh chữ ký và thời gian; không bỏ qua xác thực.

**Apple xác nhận tốt** nghĩa là còn hạn, khớp hồ sơ và có phản hồi OCSP hợp lệ mới xác nhận chưa bị thu hồi. **Chưa xác minh Apple** nghĩa là kiểm tra cục bộ đạt nhưng chưa có phản hồi OCSP hợp lệ mới, ví dụ mất mạng, timeout hoặc Apple trả `unknown`; trạng thái này không được gọi là còn sống. **Đã bị thu hồi**, **Đã hết hạn** và **Không hợp lệ** không được dùng ký từ kho. Kết quả tốt được dùng lại tối đa 10 phút (và không quá `nextUpdate`); lúc ký, nếu lần kiểm tra cũ hơn 10 phút, hệ thống kiểm tra lại. Trạng thái chưa xác minh vẫn có thể ký, nhưng không xác nhận khả năng cài/chạy trên thiết bị.

Khi dùng bộ đã lưu, máy chủ kiểm tra Bundle ID của IPA (hoặc Bundle ID bạn muốn đổi) có nằm trong phạm vi hồ sơ trước khi ký. Không tự động xác nhận các entitlement, App Extension hay UDID của mọi iPhone. Chọn **Dùng để ký** từ danh sách để chuyển nhanh về biểu mẫu.

**Xóa khỏi kho** có hộp xác nhận, xóa bản mã của bộ chứng chỉ; không xóa app đã ký hoặc bản sao tạm của phiên đang ký. Bản sao dùng để ký được dọn sau phiên xử lý. Muốn dùng lại bộ đã xóa, cần tải lại tệp gốc.

Cần **OpenSSL 3**. Installer Ubuntu và Dockerfile đã cài OpenSSL; trên Windows có thể dùng OpenSSL kèm Git for Windows hoặc đặt `OPENSSL_BIN` trong `.env`. Các CA công khai được lấy từ [Apple PKI](https://www.apple.com/certificateauthority/) và đóng gói trong `server/apple-pki.json`; không tải CA từ URL do người dùng cung cấp. Tham khảo [cấu trúc provisioning profile](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles), [thu hồi chứng chỉ](https://developer.apple.com/help/account/certificates/revoke-a-certificate/) và [xác minh OCSP của OpenSSL](https://docs.openssl.org/3.0/man1/openssl-ocsp/).

API kho chỉ dành cho admin: `GET/POST /api/admin/certificates`, `POST /api/admin/certificates/:id/check`, `DELETE /api/admin/certificates/:id`. API ký nhận `certificateId` thay cho `.p12`, `.mobileprovision` và mật khẩu khi dùng bộ trong kho. Header bảo vệ phiên cookie vẫn là `X-AppSpace-Admin: 1`.

## Logo website bằng link ảnh

Trong `/admin`, đến mục **Logo website**, dán link ảnh HTTPS trực tiếp (JPG/JPEG hoặc PNG) rồi nhấn **Lưu logo**. Logo sẽ hiển thị ở đầu và cuối trang admin, kho ứng dụng, trang cài app và trang đăng nhập. Ô xem trước giúp kiểm tra link; nếu ảnh không tải được, trang giữ logo AppSpace mặc định. Để khôi phục, bấm **Dùng logo mặc định** rồi **Lưu logo**.

Cấu hình trên máy chủ nằm trong `DATA_DIR/site-settings.json` và được giữ sau khi khởi động lại. Chỉ admin được lưu cấu hình. Trình duyệt tải ảnh trực tiếp từ link đã nhập, không gửi chứng chỉ hoặc thông tin ký app đến nguồn ảnh. Logo website không thay đổi icon của từng ứng dụng.

Với **GitHub Pages**, bấm **Xuất cấu hình Pages** sau khi lưu. Thay `site-settings.json` ở thư mục gốc repo bằng file tải về rồi commit/push. Hoặc sửa trực tiếp `logoUrl` trong file này thành link ảnh. Pages và máy chủ admin có cấu hình riêng; lưu trên admin không tự push thay đổi lên GitHub.

`setup:signer` tải **zsign v1.1.3** từ kho phát hành chính thức, xác minh SHA-256 trước khi giải nén. Hỗ trợ tự cài trên Windows x64 và Linux x64. Nền tảng khác có thể cài [zsign](https://github.com/zhlynn/zsign/tree/v1.1.3) và đặt `ZSIGN_BIN` đến file thực thi.

## Quy trình sử dụng

1. Đăng nhập `/admin`, chọn IPA, `.p12`, `.mobileprovision`; nhập mật khẩu của chứng chỉ nếu có.
2. Có thể đổi tên, Bundle ID, phiên bản và icon **JPG/JPEG hoặc PNG**. Icon được tự xoay đúng chiều, cắt vuông ở giữa và chuyển thành PNG 1024×1024 cho iOS; tối đa 8 MB và 16 megapixel. Bỏ trống để giữ icon trong IPA. Bundle ID và thiết bị phải phù hợp với hồ sơ cấp phép.
3. Nhập nhà phát triển, danh mục, mô tả, nội dung “Có gì mới”, và tối đa 5 ảnh xem trước.
4. Nhấn **Ký & tạo trang cài đặt**. Trang hiển thị tiến độ tải tệp và trạng thái ký.
5. Khi hoàn tất, sao chép link trang cài đặt hoặc tải IPA đã ký. Mỗi lần ký thành công có một link riêng `index.html?job=<id>`.

Tên, phiên bản, Bundle ID và yêu cầu iOS của trang kết quả được đọc từ IPA đầu ra. Manifest dùng `CFBundleVersion` thực tế của gói, kể cả khi khác phiên bản hiển thị. App không có ảnh xem trước hoặc mô tả sẽ ẩn các phần tương ứng; không lấy nội dung Ngọc Rồng của trang mẫu.

`index.html` là mẫu chung, không ghi cứng tên, icon, hình ảnh hay thông tin của một app. Cả `?job=<id>` và `?app=<id>` đều lấy đúng bản ghi tương ứng. Khi không tìm thấy ID, dữ liệu lỗi hoặc mất kết nối, trang báo không tìm thấy ứng dụng; không chuyển sang app khác. Ngọc Rồng Hot chỉ hiển thị khi chọn đúng ID mẫu hoặc dùng `?demo=1` trên bản có dữ liệu mẫu.

## Cài trực tiếp trên iPhone

Máy chủ phải truy cập được qua **HTTPS**. Sao chép `.env.example` thành `.env`, rồi đặt:

```dotenv
HOST=127.0.0.1
PORT=4173
PUBLIC_BASE_URL=https://apps.example.com
ADMIN_TOKEN=your-long-random-secret-at-least-24-characters
```

Đặt tên miền thật vào `PUBLIC_BASE_URL`, trỏ DNS về máy chủ và dùng reverse proxy HTTPS; có mẫu `Caddyfile.example`. Khởi động lại máy chủ trước khi ký. Đăng nhập quản trị qua `https://apps.example.com/admin`; khi cấu hình HTTPS, cookie đăng nhập chỉ gửi qua HTTPS. Hãy giữ mật khẩu riêng, không đưa vào link chia sẻ.

Sau khi ký, nút **NHẬN → Cài đặt** trên trang riêng mở liên kết `itms-services` đến manifest HTTPS, để iOS hiển thị xác nhận cài đặt. Việc cài được trên thiết bị phụ thuộc vào chứng chỉ, hồ sơ và bản IPA; ký thành công trên máy chủ không xác nhận khả năng chạy trên mọi iPhone. [Hướng dẫn phân phối qua website của Apple](https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web).

Khi chưa có `PUBLIC_BASE_URL`, hệ thống vẫn ký và cho tải IPA, nhưng không bật OTA. Không dùng link `127.0.0.1` để cài từ iPhone. Các bản đã ký lưu URL lúc tạo; nếu đổi tên miền, hãy ký lại để tạo manifest và link mới.

## Lưu trữ và quyền truy cập

- Chứng chỉ, hồ sơ, IPA đầu vào và thư mục giải nén chỉ nằm trong `data/private/<id>`. Chúng được xóa khi hoàn tất hoặc thất bại. Máy chủ xóa thư mục phiên bị gián đoạn ở lần khởi động tiếp theo. Không chạy hai tiến trình dùng chung `DATA_DIR`.
- Mật khẩu chứng chỉ không được ghi vào cơ sở dữ liệu, cấu hình công khai hay log. Công cụ zsign nhận mật khẩu qua đối số tiến trình trong lúc ký; quản trị viên hệ điều hành có quyền xem tiến trình vẫn có thể đọc được. Dùng máy chủ tin cậy và tài khoản hệ điều hành riêng.
- Kết quả trong `data/published/<id>` gồm IPA đã ký, manifest, metadata và hình ảnh; được giữ sau khi khởi động lại. Người có link có thể tải bản IPA này. Sao lưu thư mục này khi cần.
- Tệp `.p12`, `.mobileprovision`, `.env`, dữ liệu và công cụ tải về đều bị loại khỏi Git. API quản trị luôn yêu cầu phiên đăng nhập hoặc Bearer token; không còn bỏ qua xác thực cho kết nối loopback. Đăng nhập sai quá 8 lần trong 5 phút sẽ bị giới hạn theo địa chỉ kết nối.
- Máy chủ chỉ phục vụ danh sách file website và file kết quả được cho phép; không phục vụ thư mục mã nguồn hoặc tệp chứng chỉ.
- Giới hạn: một phiên ký tại một thời điểm; IPA tối đa 512 MB, tối đa 2 GB sau giải nén; mỗi ảnh tối đa 8 MB. ZIP có đường dẫn vượt thư mục, symlink, tên trùng hoặc mã hóa bị từ chối trước khi gọi zsign.

## Triển khai

### Gói cài sẵn cho Ubuntu VPS

Chạy `npm run package:vps` để tạo `packages/appspace-vps.tar.gz` và `.zip`, kèm checksum và hướng dẫn. Upload gói lên VPS, giải nén rồi chạy:

```bash
sudo bash deploy/install-ubuntu.sh apps.tenmiencuaban.com
```

Thay domain bằng tên miền đã trỏ tới VPS. Bộ cài dành cho Ubuntu 24.04/22.04 x64, cài Node.js, zsign, systemd và Caddy HTTPS; tạo mật khẩu admin mới và nhập các app đã xuất công khai. Hướng dẫn đầy đủ ở [deploy/HUONG-DAN-VPS.md](deploy/HUONG-DAN-VPS.md). Gói không chứa mật khẩu/chứng chỉ ký hay thư mục dữ liệu riêng của máy cá nhân.

### Đưa admin lên Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FAnhhPhuong06%2Fapple)

Cấu hình trong `render.yaml` tạo **một Web Service Node.js ở Singapore, 1 CPU / 2 GB RAM và ổ dữ liệu 10 GB**. Chi phí cơ bản theo [bảng giá Render](https://render.com/pricing), kiểm tra ngày 23/10/2026: **25 USD/tháng + 2,50 USD/tháng ổ lưu trữ**, chưa gồm thuế và băng thông vượt hạn mức. Bạn xem và xác nhận chi phí trên Render trước khi tạo dịch vụ; cấu hình này không phải gói miễn phí.

1. Bấm **Deploy to Render** ở trên, đăng nhập bằng GitHub và cho Render truy cập repo `AnhhPhuong06/apple`.
2. Kiểm tra cấu hình dịch vụ/chi phí, rồi xác nhận triển khai Blueprint. Build tự cài Node.js và zsign; không cần tải chứng chỉ lên GitHub.
3. Khi dịch vụ báo **Live**, mở mục **Environment** của dịch vụ, xem giá trị `ADMIN_TOKEN`. Đây là mật khẩu đăng nhập admin; không chia sẻ giá trị này.
4. Mở địa chỉ HTTPS của dịch vụ và thêm `/admin`, ví dụ `https://appspace-admin-xxxx.onrender.com/admin`. Tên miền thực tế do Render cấp.
5. Nhập `ADMIN_TOKEN`, tải IPA/chứng chỉ và ký như trên máy. App mới có link cài công khai trên cùng tên miền, không cần khách đăng nhập.

Ứng dụng tự nhận `RENDER_EXTERNAL_URL` do Render cung cấp để tạo link HTTPS, manifest và cookie đăng nhập. Nếu dùng tên miền riêng, thêm domain trong Render và đặt `PUBLIC_BASE_URL` tương ứng trước khi ký app. Tham khảo [biến môi trường của Render](https://render.com/docs/environment-variables).

`DATA_DIR=/var/data/appspace` nằm trên ổ bền vững nên app đã ký được giữ qua lần triển khai/khởi động lại. Admin được bảo vệ bằng mật khẩu tự sinh; `/healthz` chỉ trả tình trạng sẵn sàng cho Render, không cung cấp quyền admin. Blueprint tắt tự triển khai khi push để tránh ngắt phiên ký; sau khi cập nhật mã, dùng **Manual Deploy → Deploy latest commit** lúc không có phiên ký.

Máy chủ mới bắt đầu với danh sách app trống; dữ liệu riêng từ máy cá nhân không tự chuyển lên. Các app đang trên GitHub Pages vẫn dùng link cũ. Dịch vụ Render chỉ được tạo khi bạn thực hiện bước xác nhận trong tài khoản Render.

### GitHub Pages và máy chủ riêng

Đây là ứng dụng **Node.js có backend**. GitHub Pages phục vụ trang cài đặt và bản IPA đã xuất, còn trang admin/ký app chạy trên máy chủ Node.js. Workflow `pages.yml` kiểm tra và triển khai giao diện công khai lên **https://anhhphuong06.github.io/apple/** khi push nhánh `main`.

Sau khi ký một app trong trang admin, xuất app đó để đưa lên Pages:

```sh
npm run export:pages -- <id-trong-link-ket-qua> https://anhhphuong06.github.io/apple
git add public-apps
git commit -m "Publish signed app"
git push
```

Để xuất tất cả app đã ký cùng lúc, dùng `npm run export:pages -- all https://anhhphuong06.github.io/apple`, rồi commit/push thư mục `public-apps`. Việc ký thêm app không tự push lên GitHub; danh sách Pages cập nhật sau khi xuất và triển khai.

Công cụ chỉ chép IPA đã ký, ảnh, metadata công khai và tạo manifest HTTPS vào `public-apps/<id>`. Dữ liệu ký riêng tư vẫn nằm trong `data/` và không được đưa lên GitHub. Build chuyển dữ liệu công khai này sang `files/<id>/` và danh sách app tĩnh, nên link `index.html?job=<id>` không cần API hay đăng nhập. IPA lớn hơn 95 MiB cần lưu trên GitHub Releases hoặc máy chủ HTTPS riêng.

Có thể chạy bằng `npm start` trên Windows/Linux hoặc Docker x64:

```sh
docker build -t appspace-sign .
docker run --env-file .env -e HOST=0.0.0.0 -p 127.0.0.1:4173:4173 -v appspace-data:/app/data appspace-sign
```

Trong `.env`, đặt `ADMIN_TOKEN` ít nhất 24 ký tự để chủ động quản lý mật khẩu, và `PUBLIC_BASE_URL` là tên miền HTTPS không có đường dẫn. Nếu không đặt token, mật khẩu ngẫu nhiên được tạo trong volume dữ liệu. Reverse proxy chuyển tiếp đến cổng 4173. Tăng giới hạn upload của proxy cho IPA lớn. Không đưa chứng chỉ thật vào Docker image.

## Kiểm tra

### Thêm app nhanh

Mở `/admin` → **Thêm app nhanh**, chọn **IPA đã ký sẵn** hoặc **Ký bằng chứng chỉ trong kho**, chọn tối đa 20 IPA và nhấn **Thêm nhanh**. Tên, Bundle ID và phiên bản tự đọc từ từng IPA. Có thể đặt nhà phát triển và danh mục chung cho cả lượt; các giá trị trong mục này giữ nguyên để dùng cho lượt tiếp theo trên trang. Chứng chỉ đã chọn được dùng lại qua ID trong phiên trình duyệt, không đưa mật khẩu vào bộ nhớ trình duyệt.

Website tải trước IPA tiếp theo trong lúc máy chủ kiểm tra/ký app hiện tại; mỗi lượt chỉ ký một app để giữ mức sử dụng tài nguyên VPS. Kiểm tra gói và đọc metadata gộp trong một lần duyệt ZIP cho IPA đầu vào; IPA sau ký vẫn được đọc lại để lấy metadata thực tế. Không bỏ qua kiểm tra đường dẫn, giới hạn kích thước hoặc các entry nằm sau Info.plist.

Mỗi file có trạng thái, link cài và nút sao chép riêng. App lỗi được báo riêng; các app khác tiếp tục xử lý. **Thêm phần còn lại** chỉ thử lại các app chưa hoàn tất, không tạo lại app đã thành công. **Dừng sau app hiện tại** hoàn tất app đang tải/xử lý rồi dừng; phần tải trước còn thiếu có thể được tiếp tục. Giữ trang mở trong lúc thêm nhiều app; tải lại trang sẽ mất danh sách file đang chọn và các thông tin chưa gửi. Các app đã phát hành vẫn nằm trong danh sách quản lý.

Thêm nhanh tạo app mới. Để giữ link của app cũ, dùng **Cập nhật phiên bản** trong danh sách. Biểu mẫu bên dưới vẫn hỗ trợ icon, ảnh, mô tả riêng và chứng chỉ tải thủ công.

### Tải IPA nhanh và tiếp tục khi mất mạng

Trang admin tải IPA bằng các phần **8 MiB**, tối đa **3 luồng song song**, tự thử lại phần lỗi. Thanh tiến trình hiển thị dung lượng, tốc độ truyền và thời gian ước tính. Nếu mất mạng hoặc tải lại trang, chọn lại cùng file IPA và gửi lại biểu mẫu; trình duyệt kiểm tra SHA-256 các phần máy chủ đã nhận rồi chỉ gửi phần thiếu. Ảnh, chứng chỉ và các trường nhập cần được chọn/nhập lại sau khi tải lại trang.

Máy chủ ghi thẳng từng phần vào các vùng riêng của một file trong `DATA_DIR/uploads`, kiểm tra dung lượng và SHA-256 trước khi xác nhận. Phiên chờ tồn tại tối đa 24 giờ, tối đa 4 IPA (mỗi IPA tối đa 512 MiB). Phiên hết hạn được dọn khi khởi động hoặc khi tạo phiên mới. Chỉ admin được tải, xem và xóa phiên; file chờ không có link công khai. Dữ liệu chứng chỉ không nằm trong bộ nhớ đệm upload.

Khi xử lý, một hard link riêng trong thư mục làm việc cho phép dùng lại IPA mà không chép thêm toàn bộ file. Đăng IPA đã ký dùng rename; ký lỗi hoặc nhập sai thông tin vẫn giữ IPA để thử lại. Sau phát hành thành công, phiên upload được xóa. Cách này hỗ trợ upload từng yêu cầu nhỏ qua Cloudflare; [giới hạn request của Cloudflare](https://developers.cloudflare.com/network/maximum-upload-size/) vẫn áp dụng với các tệp khác. Tốc độ thực tế phụ thuộc băng thông đường truyền và VPS; số luồng song song không bảo đảm tăng tốc trên mọi mạng.

### Cập nhật phiên bản app

Vào `/admin`, tìm app trong **Ứng dụng đã tạo** rồi chọn **Cập nhật phiên bản**. Tải IPA mới và chọn đăng IPA đã ký hoặc ký bằng chứng chỉ của bạn, kể cả chứng chỉ trong kho. Trang điền lại phần giới thiệu; ảnh cũ được giữ nếu không tải ảnh thay thế. Nhập ghi chú vào **Có gì mới** rồi nhấn **Cập nhật phiên bản**.

IPA mới phải giữ Bundle ID và có phiên bản cao hơn, hoặc cùng phiên bản với build cao hơn. Phiên bản và build đọc từ IPA kết quả, gồm các thành phần số phân cách bằng dấu chấm. Link `index.html?job=<id>` giữ nguyên và danh sách vẫn chỉ có một app. Cập nhật lỗi không thay bản đang phát hành. Bản đã xử lý được ghi vào thư mục revision riêng trước khi metadata được thay thế bằng một thao tác rename; các tải xuống đã bắt đầu tiếp tục dùng bản tương ứng. Revision cũ được giữ trên đĩa và được xóa cùng app.

Chức năng này phát hành bản mới trên website; người dùng mở lại link và cài bản mới trên iPhone. Với GitHub Pages, xuất lại app bằng `export:pages`, commit và triển khai để cập nhật trang tĩnh.

```sh
npm run check
npm test
npm run build
```

`check` kiểm tra cú pháp và tài nguyên trang. `test` kiểm tra IPA, tạo manifest, phiên ký thành công/thất bại, xác thực, công khai kết quả và xóa dữ liệu tạm bằng công cụ ký giả trong kiểm thử. Công cụ ký thật được kiểm tra riêng; cài đặt trên iPhone vẫn cần thử với IPA, chứng chỉ và thiết bị hợp lệ của bạn.

`build` xuất giao diện cài đặt công khai cùng các app đã xuất trong `public-apps/` vào `_site/`, không chứa trang quản trị hay backend. `npm run preview` phục vụ giao diện mẫu; dùng `npm start` cho đăng nhập và chức năng ký thật.

## Trang mẫu và tài nguyên

`apps.js` chứa dữ liệu mẫu Ngọc Rồng Hot để tái hiện ảnh người dùng cung cấp. Điểm đánh giá, độ tuổi và dung lượng ở trang mẫu là dữ liệu thiết kế, không lấy từ App Store. Biểu tượng và ảnh game được lấy từ [trang mẫu Ngọc Rồng Hot](https://apple.102code.com/dowload/ios/nrohot/) và lưu trong `assets/`. Trang của app vừa ký dùng dữ liệu riêng của app đó.
