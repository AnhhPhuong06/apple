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

Trong admin, phần **Ứng dụng đã tạo** liệt kê các bản ký đã lưu. Bạn có thể tìm app, mở trang cài và sao chép link; danh sách vẫn có sau khi khởi động lại. Nút **Tạo app mới** xóa thông tin trong biểu mẫu để nhập app tiếp theo, giữ nguyên các bản ký trước. Mỗi lần ký tạo UUID mới, nên ngay cả hai bản cùng tên cũng có link riêng.

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

```sh
npm run check
npm test
npm run build
```

`check` kiểm tra cú pháp và tài nguyên trang. `test` kiểm tra IPA, tạo manifest, phiên ký thành công/thất bại, xác thực, công khai kết quả và xóa dữ liệu tạm bằng công cụ ký giả trong kiểm thử. Công cụ ký thật được kiểm tra riêng; cài đặt trên iPhone vẫn cần thử với IPA, chứng chỉ và thiết bị hợp lệ của bạn.

`build` xuất giao diện cài đặt công khai cùng các app đã xuất trong `public-apps/` vào `_site/`, không chứa trang quản trị hay backend. `npm run preview` phục vụ giao diện mẫu; dùng `npm start` cho đăng nhập và chức năng ký thật.

## Trang mẫu và tài nguyên

`apps.js` chứa dữ liệu mẫu Ngọc Rồng Hot để tái hiện ảnh người dùng cung cấp. Điểm đánh giá, độ tuổi và dung lượng ở trang mẫu là dữ liệu thiết kế, không lấy từ App Store. Biểu tượng và ảnh game được lấy từ [trang mẫu Ngọc Rồng Hot](https://apple.102code.com/dowload/ios/nrohot/) và lưu trong `assets/`. Trang của app vừa ký dùng dữ liệu riêng của app đó.
